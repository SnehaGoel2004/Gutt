'use strict';

const CloneManager =
  require('../core/CloneManager');

module.exports = async function cloneCommand(
  remotePath,
  targetPath
) {

  if (!remotePath || !targetPath) {

    console.log(
      '\nUsage:\n  gutt clone <source> <target>\n'
    );

    return;
  }

  const manager =
    new CloneManager();

  await manager.clone(
    remotePath,
    targetPath
  );
};