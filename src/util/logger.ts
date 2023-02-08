import { pino } from 'pino'
import 'dotenv/config';
import {IndexerConfig} from "../types/configs";
const config: IndexerConfig = require("../../config.json") as IndexerConfig;

export function createLogger(source: string) {
    const logLevel = config.logLevel || 'info';
    const devMode = (config.mode && config.mode === 'dev');
    console.log(`Creating logger for ${source} ${devMode ? ' in dev mode ' : ''} with level ${logLevel}`)
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
