import baseConfig, { speaksHttp } from '../../../eslint.config.mjs';

export default [...baseConfig, speaksHttp(['**/src/**/*.ts'])];
