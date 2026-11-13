//
//  GameQuery.swift
//  LaPioche
//
//  Created by Guillaume Richard on 13/11/2026.
//

import Vapor

struct GameQuery: Content, Validatable {
    let q: String?
    let players: Int?
    let maxDuration: Int?
    let available: Bool?

    static func validations(_ validations: inout Validations) {
        validations
            .add(
                "maxDuration",
                as: Int.self,
                is: .range(1...),
                required: false
            )
        validations
            .add("players", as: Int.self, is: .range(1...), required: false)
        validations.add("available", as: Bool.self, required: false)
    }
}
