import baseConfig, { importsContained } from '../../../eslint.config.mjs';

export default [...baseConfig, importsContained(['**/src/**/*.ts'], ['http'])];
