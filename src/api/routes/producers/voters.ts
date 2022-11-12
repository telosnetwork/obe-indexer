import { Static, Type } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";

const votersQueryParams = Type.Object({
    producer: Type.String()
})

type VotersQueryParams = Static<typeof votersQueryParams>

const votersRow = Type.Object({
    account: Type.String({
        example: 'accountname',
        description: 'Account name'
    }),
    vote_weight: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of vote weight, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
})

type VotersRow = Static<typeof votersRow>

const votersResponseSchema = Type.Object({
    voters: Type.Array(votersRow)
})

type VotersResponse = Static<typeof votersResponseSchema>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Params: VotersQueryParams, Reply: VotersResponse | ErrorResponseType }>('/voters/:producer', {
        schema: {
            tags: ['voters'],
            params: votersQueryParams,
            response: {
                200: votersResponseSchema,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        // TODO: Typecast the row results so we don't need to String(everything)
        const voters = await fastify.dbPool.query(sql`SELECT * FROM voters WHERE ${request.params.producer}=ANY(producers) ORDER BY vote_weight DESC LIMIT 500`)
        const votersResponse: VotersResponse = {
            voters: voters.rows.map((row): VotersRow => {
                return {
                    account: String(row.voter),
                    vote_weight: (parseInt(String(row.vote_weight)) / 10000).toFixed(4)

                }
            })
        }

        reply.status(200).send(votersResponse)
    })
}
