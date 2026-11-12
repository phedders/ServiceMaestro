// restructured declares power-assert as a runtime dependency but never imports
// it. The real package pulls in deprecated core-js@2; this no-op keeps that
// unused dependency tree out of the install.
module.exports = function powerAssert() {};
