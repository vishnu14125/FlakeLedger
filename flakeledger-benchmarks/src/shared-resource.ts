import * as fs from 'fs';
import * as path from 'path';

const tempFile = path.join(__dirname, '..', 'temp-resource.txt');

export async function writeResource(data: string) {
  await fs.promises.writeFile(tempFile, data, 'utf-8');
}

export async function readResource() {
  return await fs.promises.readFile(tempFile, 'utf-8');
}
