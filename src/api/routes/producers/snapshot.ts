import { Static, Type } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";

const producerSnapshotQuerystring = Type.Object({
    hoursAgo: Type.String({
        description: "Get last snapshot saved before"
    })
})

type ProducerSnapshotQuerystring = Static<typeof producerSnapshotQuerystring>

const snapshotResponseRow = Type.Any()
/*
const snapshotResponseRow = Type.Object({
    // TODO: Figure out how to specify that the keys of this object can be anything
    producers: Type.Object({
        rank: Type.Optional(Type.Number({
            example: 1,
            description: 'Producer rank'
        })),
        active: Type.Optional(Type.Boolean({
            example: true,
            description: 'Active flag'
        })),
        account: Type.Optional(Type.String({
            example: 'accountname',
            description: 'Producer account name'
        })),
        total_votes: Type.Optional(Type.String({
            example: '123456789.0123456789',
            description: 'A string representation of total vote weight, possibly too large for a Number type, use a big number library to consume it as a number'
        })),
    }, { additionalProperties: true })
})
*/

const snapshotResponse = Type.Object({
    producers: snapshotResponseRow,
    date: Type.Number({
        description: 'Datetime as epoch this snapshot was taken'
    })
})

type SnapshotResponse = Static<typeof snapshotResponse>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Querystring: ProducerSnapshotQuerystring, Reply: SnapshotResponse | ErrorResponseType }>('/snapshot', {
        schema: {
            tags: ['producers'],
            querystring: producerSnapshotQuerystring,
            response: {
                200: snapshotResponse,
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
        const producersResponse: SnapshotResponse = {
            producers,
            date: Number(row.date)
        }
        reply.status(200).send(producersResponse)
    })
}
