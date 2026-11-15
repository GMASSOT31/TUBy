import type { Env } from '../../server/auth'
import { handle } from '../../server/router'

export const onRequest: PagesFunction<Env> = ({ env, request }) => handle(env, request)
