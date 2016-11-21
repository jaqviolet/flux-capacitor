import deindent from 'deindent'
import execa from 'execa'
import fs from 'mz/fs'
import { copy } from 'fs-extra'
import { load as loadJson, update as updateJson } from 'json-update'
import mkdirp from 'mkdirp-promise'
import exists from 'path-exists'
import Listr from 'listr'
import path from 'path'
import uniq from 'uniq'
import url from 'url'
import { info, step } from '../util/cli'
import { locatePackageJson, recursiveFileList } from '../util/fs'

export default initCommand
export { initInDirectory }

async function initCommand (options, args) {
  const defaultDatabase = 'sqlite://db.sqlite'
  const { database = defaultDatabase } = options

  if (args.length > 0) {
    throw new Error(`Expected no arguments.`)
  }
  if (!('database' in options)) {
    info(`No --database passed. Using default: ${defaultDatabase}`)
  }
  if (Array.isArray(database)) {
    throw new Error(`Only one database connection URL allowed.`)
  }

  await initInDirectory(process.cwd(), database)
}

async function initInDirectory (destPath, database) {
  const templatePath = path.resolve(__dirname, '..', '..', 'template')
  const dbDriverPackage = url.parse(database).protocol.replace(/:$/, '')

  const generatedFiles = [ '.env' ]
  const templateFiles = await recursiveFileList(templatePath)
  const packageJsonPath = await locateOrCreatePackageJson(destPath)

  console.log('')   // just for the newline

  await new Listr([
    step('Copy boilerplate files', async () => {
      await assertFilesCanBeCopied(destPath, templateFiles.concat(generatedFiles))
      await copyTemplate(templatePath, templateFiles, destPath)
    }),
    step('Write .env file', async () => {
      const dotEnvFilePath = path.join(destPath, '.env')
      await fs.writeFile(dotEnvFilePath, deindent`
        PORT=3000
        DB_CONNECTION=${database}
      `.trimLeft())
    }),
    step('Update package.json', async () => {
      await patchPackageJson(packageJsonPath, path.join(destPath, 'store.js'), path.join(destPath, 'server.js'))
    }),
    step('Install dependencies', async () => {
      const packages = [
        'dotenv', 'flux-capacitor', 'flux-capacitor-boot', 'flux-capacitor-sequelize', dbDriverPackage
      ]
      await installPackages(packages, destPath)
    })
  ]).run()
}

async function assertFilesCanBeCopied (destPath, filePaths) {
  const topLevelFileDirNames = uniq(filePaths
    .map((filePath) => filePath.split(path.sep).shift())
  )

  await Promise.all(
    topLevelFileDirNames
      .map((fileName) => path.join(destPath, fileName))
      .map((filePath) => assertExistsNot(filePath))
  )
}

async function assertExistsNot (filePath) {
  if (await exists(filePath)) {
    throw new Error(`File/directory already exists: ${filePath}`)
  }
}

async function locateOrCreatePackageJson (searchStartDirPath) {
  try {
    const filePath = await locatePackageJson(searchStartDirPath)
    info(`Found package.json: ${filePath}`)
    return filePath
  } catch (error) {
    const filePath = path.join(searchStartDirPath, 'package.json')
    info(`Creating empty ${filePath}...`)
    await fs.writeFile(filePath, '{}\n')
    return filePath
  }
}

async function patchPackageJson (filePath, storeJsPath, serverJsPath) {
  const previousContent = await loadJson(filePath)
  const diff = {
    flux: {
      store: path.relative(path.dirname(filePath), storeJsPath)
    },
    scripts: Object.assign({
      start: `node ${path.relative(path.dirname(filePath), serverJsPath)}`
    }, previousContent.scripts)
  }

  return await updateJson(filePath, diff)
}

async function copyTemplate (templatePath, files, destPath) {
  return await Promise.all(
    files.map((relativeFilePath) => copyFile(
      path.join(templatePath, relativeFilePath),
      path.join(destPath, relativeFilePath)
    ))
  )
}

function copyFile (from, to) {
  return new Promise((resolve, reject) => {
    copy(from, to, (error) => {
      error ? reject(error) : resolve()
    })
  })
}

async function installPackages (packageNames, cwd = process.cwd()) {
  const npmInstallCommand = `npm install --save ${packageNames.join(' ')}`
  return await execa.shell(npmInstallCommand, { cwd })
}