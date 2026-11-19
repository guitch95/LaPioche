//
//  UserDTO.swift
//  LaPioche
//
//  Created by Guillaume Richard on 19/11/2026.
//

import Foundation
import Vapor

struct UserDTO: Content {
    let id: UUID?
    let email: String
}

extension User {
    func toDTO() -> UserDTO {
        UserDTO(id: id, email: email)
    }
}
