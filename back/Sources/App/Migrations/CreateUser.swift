//
//  CreateUser.swift
//  LaPioche
//
//  Created by Guillaume Richard on 19/11/2026.
//

import Fluent
import Vapor

struct CreateUser: AsyncMigration {
    func prepare(on database: any Database) async throws {
        try await database.schema("users")
            .id()
            .field("email", .string, .required)
            .field("password_hash", .string, .required)
            .unique(on: "email")
            .create()
    }

    func revert(on database: any Database) async throws {
        try await database.schema("users").delete()
    }
}
