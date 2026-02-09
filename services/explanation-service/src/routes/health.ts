/**
 * Health check route handler
 */
import { json } from '../utils/response';

export function handleHealth(port: number): Response {
  return json({ ok: true, service: 'explanation-service', port });
}
