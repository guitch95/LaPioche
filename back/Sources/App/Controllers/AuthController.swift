//
//  File.swift
//  LaPioche
//
//  Created by Guillaume Richard on 13/11/2026.
//

import Fluent
import JWT
import Vapor

struct AuthController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let auth = routes.grouped("auth")
        auth.post("login", use: login)
        auth.post("register", use: register)

        let protected = auth.grouped(JWTMiddleware())
        protected.get("me", use: me)

    }
    @Sendable
    func login(req: Request) async throws -> AuthResponseDTO {
        // Décoder les données utilisateur à partir de la requête
        let dto = try req.content.decode(LoginDTO.self)

        // Rechercher l'utilisateur par email
        guard let user = try await User.query(on: req.db)
            .filter(\.$email == dto.email.lowercased())
            .first() else {
            throw Abort(
                .unauthorized,
                reason: "Email ou mot de passe incorrect."
            )  // L'utilisateur n'existe pas
        }

        // Vérification du mot de passe
        guard
            try Bcrypt
                .verify(dto.password, created: user.passwordHash)
                else {
            throw Abort(
                .unauthorized,
                reason: "Email ou mot de passe incorrect."
            )  // Mot de passe incorrect
        }

        // Génération du token JWT
        // try : requireID() échoue si le user n'a pas d'id (normalement impossible pour un user venant de la base)
        let payload = UserPayload(id: try user.requireID())
        // et sign échoue si la signature rate.
        let token = try await req.jwt.sign(payload)
        return AuthResponseDTO(
            token: token,
            expiresAt:payload.expiration ,
            user: user.toDTO()
        )
    }

    @Sendable
    func register (req:Request) async throws -> Response {
        try LoginDTO.validate(content: req)
        let dto = try req.content.decode(LoginDTO.self)

        let email = dto.email.lowercased()

        // Check email
        let emailTaken = try await User.query(on: req.db)
            .filter(\.$email == email)
            .first() != nil
        guard !emailTaken else {
            throw Abort(.conflict, reason: "Un compte existe déjà avec cette adresse e-mail.")
        }

        // hash password
        let hash = try Bcrypt.hash(dto.password)

        let user = User(email: email, passwordHash: hash)
        try await user.save(on: req.db)

        // Génération token
        let payload = UserPayload(id: try user.requireID())
        let token = try await req.jwt.sign(payload)
        let response = AuthResponseDTO(token: token, expiresAt: payload.expiration, user: user.toDTO())

        // 201 créé
        return try await response.encodeResponse(status: .created, for: req)
    }

    @Sendable
    func me(req: Request) throws -> UserDTO {
        let payload = try req.auth.require(User.self).toDTO()
        return payload
    }
}
