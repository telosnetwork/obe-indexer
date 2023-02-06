import Indexer from "./indexer/Indexer";
import {IndexerConfig} from "./types/configs";
const config: IndexerConfig = require("../config.json") as IndexerConfig;
import {createLogger} from "./util/logger";

const logger = createLogger('Indexer launcher', 'indexer')

;(async () => {
    logger.info("Starting indexer...");
    const indexer = await Indexer.create(config);
    await indexer.run();
})().catch((e) => {
    logger.error(`Error while running indexer: ${e}`);
})
