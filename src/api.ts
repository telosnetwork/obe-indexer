import Api from "./api/Api";
import {IndexerConfig} from "./types/configs";
import {createLogger} from "./util/logger";
const config: IndexerConfig = require("../config.json") as IndexerConfig;

const logger = createLogger('Api launcher')

;(async () => {
    logger.info("Starting api...");
    const api = new Api(config)
    await api.run()
})().catch((e) => {
    logger.error(`Error while running api: ${e.message}`);
})
