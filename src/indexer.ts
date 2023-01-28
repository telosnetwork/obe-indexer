import Indexer from "./indexer/Indexer";
import {IndexerConfig} from "./types/configs";
import {createLogger} from "./util/logger";
const config: IndexerConfig = require("../config.json") as IndexerConfig;

const logger = createLogger('Indexer launcher', 'indexer')

;(async () => {
    logger.info("Starting indexer...");
    const indexer = await Indexer.create(config);
    await indexer.run();
})().catch((e) => {
    logger.error(`Error while running indexer: ${e}`);
})
