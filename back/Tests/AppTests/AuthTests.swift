@testable import App
import JWT
import XCTVapor

final class AuthTests: XCTestCase {

    // MARK: - Inscription

    func testRegisterReturnsCreatedWithTokenAndAccount() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/register", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: "Nouveau@Example.com", password: "password123"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .created)
                let body = try res.content.decode(AuthResponseDTO.self)
                XCTAssertFalse(body.token.isEmpty)
                XCTAssertEqual(body.user.email, "nouveau@example.com") // enregistré en minuscules
                XCTAssertNotNil(body.user.id)

                // Valable 24 h (à quelques secondes près)
                let validity = body.expiresAt.timeIntervalSinceNow
                XCTAssertEqual(validity, 24 * 60 * 60, accuracy: 60)

                // Le mot de passe et son hash n'apparaissent jamais dans la réponse
                let raw = res.body.string
                XCTAssertFalse(raw.contains("password123"))
                XCTAssertFalse(raw.lowercased().contains("password"))
            })
        }
    }

    func testRegisteredTokenGivesAccessToProtectedRoutes() async throws {
        try await withApp { app in
            let auth = try await register(app, email: "autre@example.com", password: "password123")

            try await app.authTest(.GET, "games", token: auth.token, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
        }
    }

    func testRegisterWithInvalidEmailIsRejected() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/register", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: "pas-un-email", password: "password123"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }

    func testRegisterWithShortPasswordIsRejected() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/register", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: "autre@example.com", password: "1234567"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .badRequest)
            })
        }
    }

    func testRegisterWithTakenEmailReturnsConflict() async throws {
        try await withApp { app in
            // `withApp` a déjà créé staff@example.com
            try await app.test(.POST, "auth/register", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: testEmail, password: "password123"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .conflict)
            })
        }
    }

    func testRegisterWithTakenEmailInAnotherCaseReturnsConflict() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/register", beforeRequest: { req in
                // Pas `.uppercased()` sur toute l'adresse : le validateur `.email` de Vapor
                // refuse une extension de domaine en majuscules (".COM" → 400).
                try req.content.encode(LoginDTO(email: "STAFF@Example.com", password: "password123"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .conflict)
            })
        }
    }

    // MARK: - Connexion

    func testLoginReturnsOkWithTokenAndAccount() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/login", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: testEmail, password: testPassword))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                let body = try res.content.decode(AuthResponseDTO.self)
                XCTAssertFalse(body.token.isEmpty)
                XCTAssertEqual(body.user.email, testEmail)
                XCTAssertFalse(res.body.string.lowercased().contains("password"))
            })
        }
    }

    func testLoginIgnoresEmailCase() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/login", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: testEmail.uppercased(), password: testPassword))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
        }
    }

    func testLoginWithWrongPasswordReturnsUnauthorized() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/login", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: testEmail, password: "mauvais-mot-de-passe"))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    func testLoginWithUnknownEmailReturnsUnauthorized() async throws {
        try await withApp { app in
            try await app.test(.POST, "auth/login", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: "inconnu@example.com", password: testPassword))
            }, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    func testLoginErrorMessageDoesNotRevealWhichAccountsExist() async throws {
        try await withApp { app in
            var wrongPasswordReason: String?
            var unknownEmailReason: String?

            try await app.test(.POST, "auth/login", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: testEmail, password: "mauvais-mot-de-passe"))
            }, afterResponse: { res async throws in
                wrongPasswordReason = try res.content.decode(ErrorBody.self).reason
            })
            try await app.test(.POST, "auth/login", beforeRequest: { req in
                try req.content.encode(LoginDTO(email: "inconnu@example.com", password: testPassword))
            }, afterResponse: { res async throws in
                unknownEmailReason = try res.content.decode(ErrorBody.self).reason
            })

            XCTAssertNotNil(wrongPasswordReason)
            XCTAssertEqual(wrongPasswordReason, unknownEmailReason)
        }
    }

    // MARK: - /auth/me

    func testMeReturnsTheConnectedAccount() async throws {
        try await withApp { app in
            try await app.authTest(.GET, "auth/me", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
                XCTAssertEqual(try res.content.decode(UserDTO.self).email, testEmail)
                XCTAssertFalse(res.body.string.lowercased().contains("password"))
            })
        }
    }

    func testMeWithoutTokenReturnsUnauthorized() async throws {
        try await withApp { app in
            try await app.test(.GET, "auth/me", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    // MARK: - Protection des routes

    // Toutes les routes protégées, avec des identifiants quelconques :
    // le middleware doit répondre 401 avant même de chercher la ressource.
    private let protectedRoutes: [(HTTPMethod, String)] = {
        let id = UUID()
        return [
            (.GET, "games"),
            (.POST, "games"),
            (.GET, "games/\(id)"),
            (.PUT, "games/\(id)"),
            (.DELETE, "games/\(id)"),
            (.GET, "members"),
            (.POST, "members"),
            (.GET, "members/\(id)"),
            (.PUT, "members/\(id)"),
            (.DELETE, "members/\(id)"),
            (.GET, "members/\(id)/loans"),
            (.GET, "loans"),
            (.GET, "loans/overdue"),
            (.POST, "loans"),
            (.DELETE, "loans/\(id)"),
            (.POST, "loans/\(id)/return"),
        ]
    }()

    func testEveryProtectedRouteRejectsRequestsWithoutToken() async throws {
        try await withApp { app in
            for (method, path) in protectedRoutes {
                try await app.test(method, path, afterResponse: { res async throws in
                    XCTAssertEqual(res.status, .unauthorized, "\(method) /\(path) devrait répondre 401 sans jeton")
                })
            }
        }
    }

    func testMalformedTokenIsRejected() async throws {
        try await withApp { app in
            try await app.authTest(.GET, "games", token: "pas-un-jwt", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    func testTokenSignedWithAnotherSecretIsRejected() async throws {
        try await withApp { app in
            let userID = try await currentUserID(app)

            let otherKeys = JWTKeyCollection()
            await otherKeys.add(hmac: HMACKey(from: "un-autre-secret-de-au-moins-32-caracteres"), digestAlgorithm: .sha256)
            let forged = try await otherKeys.sign(UserPayload(id: userID))

            try await app.authTest(.GET, "games", token: forged, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    func testExpiredTokenIsRejected() async throws {
        try await withApp { app in
            let userID = try await currentUserID(app)
            let expired = try await app.jwt.keys.sign(
                UserPayload(id: userID, expiration: .now.addingTimeInterval(-60))
            )

            try await app.authTest(.GET, "games", token: expired, afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    func testTokenOfDeletedAccountIsRejected() async throws {
        try await withApp { app in
            let userID = try await currentUserID(app)
            try await User.find(userID, on: app.db)?.delete(on: app.db)

            try await app.authTest(.GET, "games", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .unauthorized)
            })
        }
    }

    // MARK: - Public

    func testSwaggerFilesStayPublic() async throws {
        try await withApp { app in
            try await app.test(.GET, "openapi.yaml", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
            try await app.test(.GET, "index.html", afterResponse: { res async throws in
                XCTAssertEqual(res.status, .ok)
            })
        }
    }

    func testCorsAllowsTheAuthorizationHeader() async throws {
        try await withApp { app in
            try await app.test(.OPTIONS, "games", beforeRequest: { req in
                req.headers.replaceOrAdd(name: .origin, value: "http://localhost:8080")
                req.headers.replaceOrAdd(name: .accessControlRequestMethod, value: "GET")
                req.headers.replaceOrAdd(name: .accessControlRequestHeaders, value: "authorization")
            }, afterResponse: { res async throws in
                let allowed = res.headers[.accessControlAllowHeaders].joined(separator: ",").lowercased()
                XCTAssertTrue(allowed.contains("authorization"))
            })
        }
    }

    // MARK: - Helpers

    private struct ErrorBody: Decodable {
        let reason: String
    }

    // Id du compte créé par `withApp`, récupéré via /auth/me.
    private func currentUserID(_ app: Application) async throws -> UUID {
        var id: UUID?
        try await app.authTest(.GET, "auth/me", afterResponse: { res async throws in
            id = try res.content.decode(UserDTO.self).id
        })
        return try XCTUnwrap(id)
    }
}
