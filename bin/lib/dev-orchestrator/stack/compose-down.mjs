export function composeDownArgs({ projectName, composeFile, overrideFile }) {
  return ['compose', '-p', projectName, '-f', composeFile, '-f', overrideFile, 'down'];
}
