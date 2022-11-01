import * as http from "http";
import {DatabasePool} from "slonik";

declare module "fastify" {
    export interface FastifyInstance<
        HttpServer = http.Server,
        HttpRequest = http.IncomingMessage,
        HttpResponse = http.ServerResponse
        > {
        dbPool: DatabasePool;
    }
}
