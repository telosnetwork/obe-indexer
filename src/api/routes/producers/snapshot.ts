import { Static, Type } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";

const producerSnapshotQuerystring = Type.Object({
    hoursAgo: Type.String()
})

type ProducerSnapshotQuerystring = Static<typeof producerSnapshotQuerystring>

const producerSnapshot = Type.Any()
/*
const producerSnapshot = Type.Object({
    // TODO: Figure out how to specify that the keys of this object can be anything
    producers: Type.Object({
        account: Type.String({
            example: 'accountname',
            description: 'Producer account name'
        }),
        rank: Type.Number({
            example: 1,
            description: 'Producer rank'
        }),
        total_votes: Type.String({
            example: '123456789.0123456789',
            description: 'A string representation of total vote weight, possibly too large for a Number type, use a big number library to consume it as a number'
        }),
    })
})
*/

type ProducerSnapshot = Static<typeof producerSnapshot>

const producerSnapshotResponseSchema = Type.Object({
    producers: producerSnapshot,
    date: Type.Number({
        description: 'Datetime as epoch this snapshot was taken'
    })
})

type ProducersResponse = Static<typeof producerSnapshotResponseSchema>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Querystring: ProducerSnapshotQuerystring, Reply: ProducersResponse | ErrorResponseType }>('/snapshot', {
        schema: {
            tags: ['producers'],
            querystring: producerSnapshotQuerystring,
            response: {
                200: producerSnapshotResponseSchema,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        const hoursAgoInterval = `${request.query.hoursAgo ? parseInt(request.query.hoursAgo) : 24} HOURS`
        const snapshotResult = await fastify.dbPool.query(sql`SELECT * FROM producer_snapshot WHERE date <= NOW() - ${hoursAgoInterval}::interval LIMIT 1`)
        const row = snapshotResult.rows[0]
        if (!row) {
            reply.status(404).send({
                details: `Unable to find snapshot`,
                message: `Unable to find snapshot`
            })
        }
        const producers: any = row.snapshot
        const producersResponse: ProducersResponse = {
            producers,
            date: Number(row.date)
        }
        reply.status(200).send(producersResponse)
    })
}
