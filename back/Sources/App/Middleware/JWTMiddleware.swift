//
//  File.swift
//  LaPioche
//
//  Created by Guillaume Richard on 18/11/2026.
//

import Vapor
import JWT

final class JWTMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: any AsyncResponder) async throws -> Response {
        // Récupère le token de l'en-tête "Authorization: Bearer <token>"
        guard let token = request.headers.bearerAuthorization?.token else {
            throw Abort(.unauthorized, reason: "Token manquant.")
        }

        // Vérifie la signature et l'expiration, puis récupère le payload
        let payload: UserPayload
        do {
            payload = try await request.jwt.verify(token, as: UserPayload.self)
        } catch {
            throw Abort(.unauthorized, reason: "Token Invalide.")
        }

        guard let user = try await User.find(payload.id, on: request.db) else {
            throw Abort(.unauthorized, reason: "Compte introuvable.")
        }

        // Attache le user à la requête
        request.auth.login(user)

        // Passe à la suite (la route)
        return try await next.respond(to: request)
    }
}
