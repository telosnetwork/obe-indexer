import { Static, Type } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply, paginationQueryParams} from "../../../util/utils";
import { z } from "zod";

const votersQueryParams = Type.Object({
    producer: Type.String()
})

type VotersQueryParams = Static<typeof votersQueryParams>
type PaginationQueryParams = Static<typeof paginationQueryParams>

const votersRow = Type.Object({
    voter: Type.String({
        example: 'accountname',
        description: 'Account name'
    }),
    vote_weight: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of vote weight, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
})

const votersQueryRow = z.object({
    voter: z.string(),
    vote_weight: z.string(),
})
type VotersQueryRow = z.infer<typeof votersQueryRow>;

type VotersRow = Static<typeof votersRow>

const votersResponseSchema = Type.Object({
    totalVoters: Type.String({
        example: '112',
        description: 'A string representation of the total count of voters for this producer, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    voters: Type.Array(votersRow)
})

type VotersResponse = Static<typeof votersResponseSchema>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Params: VotersQueryParams, Reply: VotersResponse | ErrorResponseType, Querystring: PaginationQueryParams }>('/voters/:producer', {
        schema: {
            tags: ['producers'],
            params: votersQueryParams,
            querystring: paginationQueryParams,
            response: {
                200: votersResponseSchema,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        const limit = request.query.limit || 100;
        const offset = request.query.offset || 0;
        const query = sql.type(votersQueryRow)`SELECT voter, vote_weight FROM voters WHERE ${request.params.producer}=ANY(producers) ORDER BY vote_weight DESC LIMIT ${limit} OFFSET ${offset}`;
        const voters = await fastify.dbPool.any(query)
        const votersCount = await fastify.dbPool.maybeOne(sql`SELECT COUNT(*) as count FROM voters WHERE ${request.params.producer}=ANY(producers)`)
        const votersResponse: VotersResponse = {
            totalVoters: (votersCount) ? votersCount.count as string : '0',
            voters: voters.map((row: VotersQueryRow): VotersRow => {
                return {
                    voter: row.voter,
                    vote_weight: (parseInt(row.vote_weight) / 10000).toFixed(4)
                }
            })
        }

        reply.status(200).send(votersResponse)
    })
}
