import { handle } from '../server.mjs';

export default function app(request, response) {
  return handle(request, response, { hosted: true });
}
