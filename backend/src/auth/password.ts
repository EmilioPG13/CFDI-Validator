// bcryptjs, NOT bcrypt -- bcrypt is a native addon requiring node-gyp, the same class of
// Windows-11-hostile native-compilation problem CLAUDE.md already documents for why
// libxml2-wasm was chosen over libxmljs2-xsd/node-libxml-xsd. bcryptjs is a pure-JS,
// drop-in hash/compare API.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
