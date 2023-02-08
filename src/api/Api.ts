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
import {createDbPool} from "../util/database";

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
        const dbPool = await createDbPool(this.config);
        this.fastify.decorate(`dbPool`, dbPool);
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

    private async registerPlugins() {
        await this.fastify.register(fastifyCors)
        this.fastify.register(fastifyTraps, {
            timeout: 3000
        })
        await this.fastify.register(fastifySwagger, {
            swagger: {
                info: {
                    title: `${this.config.displayNetworkName} Telos OBE API`,
                    description: `API for ${this.config.displayNetworkName} Open Block Explorer`,
                    version: `${this.config.apiVersion}`
                },
                externalDocs: {
                    url: `${this.config.documentationUrl}`,
                    description: 'Find more information in our documentation'
                },
                host: `${this.config.apiHost}`,
                schemes: this.config.apiProtocols,
                tags: [
                    {name: 'tokens', description: 'Token stats endpoints'},
                    {name: 'voters', description: 'Voter stats endpoints'},
                    {name: 'producers', description: 'Producer stats endpoints'}
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
