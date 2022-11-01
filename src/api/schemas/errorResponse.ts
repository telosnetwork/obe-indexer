import {Static, Type} from "@sinclair/typebox";

const errorResponse = Type.Object({
    message: Type.String(),
    details: Type.String()
})

type ErrorResponseType = Static<typeof errorResponse>

export { errorResponse, ErrorResponseType }
