import { pino } from 'pino'
import 'dotenv/config';
const devMode = process.env.MODE == 'dev'

export function createLogger(source: string, module: string) {
    const logLevelAPI = process.env.API_LOG_LEVEL || 'info';
    const logLevelIndexer = process.env.INDEXER_LOG_LEVEL || 'info';
    const logLevel = (module === 'api') ? logLevelAPI : logLevelIndexer;
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
