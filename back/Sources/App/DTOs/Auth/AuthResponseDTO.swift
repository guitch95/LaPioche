//
//  File.swift
//  LaPioche
//
//  Created by Guillaume Richard on 18/11/2026.
//

import Foundation
import Vapor

struct AuthResponseDTO: Content {
    let token: String
    let expiresAt: Date
    let user: UserDTO
}
