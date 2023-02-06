import { pino } from 'pino'
import 'dotenv/config';
import {IndexerConfig} from "../types/configs";
const config: IndexerConfig = require("../../config.json") as IndexerConfig;

export function createLogger(source: string, module: string) {
    const logLevelAPI = config.apiLogLevel || 'info';
    const logLevelIndexer = config.indexerLogLevel || 'info';
    const logLevel = (module === 'api') ? logLevelAPI : logLevelIndexer;
    const devMode = (config.mode && config.mode === 'dev');
    console.log(`Creating ${module} logger for ${source} ${devMode ? ' in dev mode ' : ''} with level ${logLevel}`)
    const options = {
        level: logLevel,
        name: source,
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true
            }
        }
    }

    return pino(options)
}
