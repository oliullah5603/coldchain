import { config } from '../src/config.js';
import { Store } from '../src/store.js';
const cfg = config(); const store = new Store(cfg.dataDir, cfg.auditKey);
const result = store.verify(); console.log(JSON.stringify(result, null, 2)); store.close();
if (!result.valid) process.exitCode = 1;
