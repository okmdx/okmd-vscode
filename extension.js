const vscode = require('vscode');
const path = require('path');
const moment = require('moment');
const fs = require('fs');
const {
  spawn
} = require('child_process');
const qnUpload = require('./lib/upload');
const { v4: uuidv4 } = require('uuid');

exports.activate = (context) => {
  // Get or generate UUID
  let uuid = context.globalState.get('okmd.uuid');
  console.log('Existing UUID:', uuid);  // Log existing UUID

  if (!uuid) {
    uuid = uuidv4();
    console.log('Generated new UUID:', uuid);  // Log newly generated UUID
    context.globalState.update('okmd.uuid', uuid);
    console.log('UUID saved to global state');  // Log save operation
  }
  
  console.log('Final UUID:', uuid);  // Log final UUID value
  
  const disposable = vscode.commands.registerCommand('extension.okmd', () => {
    start(uuid);
  });
  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
exports.deactivate = () => { }

function start(uuid) {
  console.log('start function called with UUID:', uuid);  // Log UUID in start function
  // Get the currently edited file
  let editor = vscode.window.activeTextEditor;
  if (!editor) return;

  let fileUri = editor.document.uri;
  if (!fileUri) return;

  if (fileUri.scheme === 'untitled') {
    vscode.window.showInformationMessage('Before paste image, you need to save current edit file first.');
    return;
  }

  let selection = editor.selection;
  let selectText = editor.document.getText(selection);

  if (selectText && !/^[\w\-.]+$/.test(selectText)) {
    vscode.window.showInformationMessage('Your selection is not a valid file name!');
    return;
  }
  let config = vscode.workspace.getConfiguration('qiniu');
  let localPath = config['localPath'];
  if (localPath && (localPath.length !== localPath.trim().length)) {
    vscode.window.showErrorMessage('The specified path is invalid. "' + localPath + '"');
    return;
  }

  let filePath = fileUri.fsPath;
  let imagePath = getImagePath(filePath, selectText, localPath);
  const mdFilePath = editor.document.fileName;
  const mdFileName = path.basename(mdFilePath, path.extname(mdFilePath));

  createImageDirWithImagePath(imagePath).then(imagePath => {
    saveClipboardImageToFileAndGetPath(imagePath, (imagePath) => {
      if (!imagePath) return;
      if (imagePath === 'no image') {
        vscode.window.setStatusBarMessage("There is not a image in clipboard.", 3000);
        return;
      }
      qnUpload(config, imagePath, mdFilePath, uuid).then(({
        name,
        url
      }) => {
        vscode.window.setStatusBarMessage("Upload success", 3000);
        const img = `![${name}](${url})`;
        editor.edit(textEditorEdit => {
          textEditorEdit.insert(editor.selection.active, img)
        });
        fs.unlink(imagePath, (err) => {
          if (err) {
            vscode.window.showInformationMessage(err);
          } else {
            // vscode.window.showInformationMessage('delete ok');
          }
        });
      }).catch((err) => {
        console.log('err', err);
        vscode.window.showErrorMessage('Upload error.');
      });
    });
  }).catch(err => {
    vscode.window.showErrorMessage('Failed make folder.');
    return;
  });
}

function getImagePath(filePath, selectText, localPath) {
  // 图片名称
  let imageFileName = '';
  if (!selectText) {
    imageFileName = 's' + moment().format("HHmmssMMDDY") + '.png';
  } else {
    imageFileName = selectText + '.png';
  }

  // Image local save path
  let folderPath = path.dirname(filePath);
  let imagePath = '';
  if (path.isAbsolute(localPath)) {
    imagePath = path.join(localPath, imageFileName);
  } else {
    imagePath = path.join(folderPath, localPath, imageFileName);
  }

  return imagePath;
}

function createImageDirWithImagePath(imagePath) {
  // let imageDir = path.dirname(imagePath)
  // let config = vscode.workspace.getConfiguration('qiniu');
  // vscode.window.showInformationMessage(imageDir);
  return new Promise((resolve, reject) => {
    let imageDir = path.dirname(imagePath);
    fs.exists(imageDir, (exists) => {
      if (exists) {
        resolve(imagePath);
        return;
      }
      fs.mkdir(imageDir, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(imagePath);
      });
    });
  });
}

function saveClipboardImageToFileAndGetPath(imagePath, cb) {
  if (!imagePath) return;
  let platform = process.platform;

  if (platform === 'win32') {
    // Windows
    const scriptPath = path.join(__dirname, './lib/pc.ps1');
    const powershell = spawn('powershell', [
      '-noprofile',
      '-noninteractive',
      '-nologo',
      '-sta',
      '-executionpolicy', 'unrestricted',
      '-windowstyle', 'hidden',
      '-file', scriptPath,
      imagePath
    ]);
    powershell.on('exit', function (code, signal) {

    });
    powershell.stdout.on('data', function (data) {
      cb(data.toString().trim());
    });
  } else if (platform === 'darwin') {
    // Mac
    let scriptPath = path.join(__dirname, './lib/mac.applescript');

    let ascript = spawn('osascript', [scriptPath, imagePath]);
    ascript.on('exit', function (code, signal) {

    });

    ascript.stdout.on('data', function (data) {
      cb(data.toString().trim());
    });
  } else {
    // Linux 

    let scriptPath = path.join(__dirname, './lib/linux.sh');

    let ascript = spawn('sh', [scriptPath, imagePath]);
    ascript.on('exit', function (code, signal) {

    });

    ascript.stdout.on('data', function (data) {
      let result = data.toString();
      if (result == "no xclip") {
        vscode.window.showInformationMessage('You need to install xclip command first.');
        return;
      }
      cb(result);
    });
  }
}
