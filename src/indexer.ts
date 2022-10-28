import Indexer from "./indexer/Indexer";
import {IndexerConfig} from "./types/configs";
//import config from "./configs";
//import config from "../config.json" as IndexerConfig;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config: IndexerConfig = require("../config.json") as IndexerConfig;

(async () => {
    console.log("Starting indexer...");
    const indexer = await Indexer.create(config);
    await indexer.run();
})().catch((e) => {
    console.error(`Error while running indexer`, e);
});