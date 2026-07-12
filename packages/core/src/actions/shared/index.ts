export { webFingerprint, wafDetect, headerInspect } from "./web-recon.js";
export { linuxPrivesc, windowsPrivesc } from "./privesc.js";
export { crackHashes, passwordSpray } from "./cred-cracking.js";
export { sysinfo, localCreds, internalNet } from "./post-exploit.js";
export {
  windowsForensics,
  collectNtuser,
  collectRegistryHives,
  checkCredentialStores,
  interestingFiles,
} from "./windows-forensics.js";
export {
  lateralMovement,
  enumerateContext,
  identifyBoundary,
  exploitBoundary,
} from "./lateral-movement.js";
export {
  pathTraversal,
  testPlainTraversal,
  testSingleEncoded,
  testDoubleEncoded,
  testUnicodeTraversal,
  testNullByte,
} from "./path-traversal.js";
