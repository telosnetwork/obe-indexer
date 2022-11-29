import {FastifyInstance, FastifyListenOptions} from "fastify";
import {IndexerConfig} from "../types/configs";
import {fastify} from "fastify";
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import fastifySwagger, {FastifySwaggerOptions, SwaggerOptions} from '@fastify/swagger'
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyTraps from '@dnlup/fastify-traps'
import fastifyCors from '@fastify/cors'
import fastifyAutoLoad from '@fastify/autoload'
import path from 'path'

import {createLogger} from "../util/logger";
import {createQueryLoggingInterceptor} from "slonik-interceptor-query-logging";
import {createPool} from "slonik";

const logger = createLogger('Api')

export default class Api {

    private fastify: FastifyInstance
    private config: IndexerConfig

    constructor(config: IndexerConfig) {
        this.config = config

        // TODO: make this happy with ts
        //    withTypeProvider returns FastifyInstance<RawServer, RawRequest, RawReply, Logger, Provider>
        //    and we have it declared as FastifyInstance without types... seems that should be ok
        // @ts-ignore
        this.fastify = fastify({
            trustProxy: true,
            logger
        }).withTypeProvider<TypeBoxTypeProvider>()
    }

     async run() {
        await this.createDbPool()
        await this.registerPlugins()
        await this.registerRoutes()
        await this.fastify.ready(err => {
            if (err) {
                logger.info(`Error starting fastify - ${err.message}`)
                throw err
            }
        })

        this.fastify.swagger()
        const opts: FastifyListenOptions = {
            port: this.config.apiPort,
            host: this.config.apiAddress
        }

        this.fastify.listen(opts, err => {
            if (err) throw err
        })
    }

    private async createDbPool() {
        const {dbHost, dbName, dbUser, dbPass, dbPort} = this.config;
        const interceptors = [
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            createQueryLoggingInterceptor()
        ];

        // TODO: configure this or just disable in production code
        //const opts = {interceptors};
        const opts = {};

        try {
            const connectionString = `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
            const dbPool = await createPool(connectionString, opts);
            this.fastify.decorate(`dbPool`, dbPool);
        } catch (e) {
            logger.error(`Failed creating db pool`, e);
        }
    }

    private async registerPlugins() {
        await this.fastify.register(fastifyCors)
        this.fastify.register(fastifyTraps, {
            timeout: 3000
        })
        await this.fastify.register(fastifySwagger, {
            swagger: {
                info: {
                    title: 'Telos Native Stats',
                    description: 'Telos Native Stats APIs',
                    version: '0.1.0'
                },
                externalDocs: {
                    url: 'https://docs.telos.net',
                    description: 'Find more info here'
                },
                host: `${this.config.apiHost}`,
                schemes: this.config.apiProtocols,
                tags: [
                    {name: 'chain', description: 'Chain statistics endpoints'},
                    {name: 'tokens', description: 'Token stats endpoints'}
                ]
            }
        })
        await this.fastify.register(fastifySwaggerUi, {
            routePrefix: `/v1/docs`
        })
        await this.fastify.register(fastifyAutoLoad, { dir: path.join(__dirname, 'routes'), options: { prefix: `/v1` } });

    }

    private registerRoutes() {
        // @ts-ignore
        this.fastify.get('/', {prefixTrailingSlash: undefined, schema: { hide: true } }, (request, reply) => {
            reply.code(307).redirect(`/v1/docs`)
        });

        // @ts-ignore
        this.fastify.get(`/v1/health`, { logLevel: 'fatal', schema: { hide: true } }, (request, reply) => {
            reply.code(200).send("Ok!")
        });


    }

}
