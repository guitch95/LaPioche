//
//  File.swift
//  LaPioche
//
//  Created by Guillaume Richard on 13/11/2026.
//

import Vapor
import JWT

struct UserPayload: JWTPayload {
    var id: UUID
    var expiration: Date

    // JWT 5 : `some JWTAlgorithm` au lieu de `JWTSigner`
    func verify(using algorithm: some JWTAlgorithm) async throws {
        guard expiration > .now else {
            throw Abort(.unauthorized, reason: "Token expiré.") // refusé si la date est dépassée
        }
    }

    // Initialisateur qui définit l'ID et la date d'expiration
    init(id: UUID, expiration: Date = .now.addingTimeInterval(60 * 60 * 24)) { // 24h
        self.id = id
        self.expiration = expiration    }

}
