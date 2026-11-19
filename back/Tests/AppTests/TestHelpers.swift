@testable import App
import XCTVapor

// Compte créé automatiquement au début de chaque test, pour pouvoir appeler les routes protégées.
let testEmail = "staff@example.com"
let testPassword = "correct-horse"

func withApp(_ test: (Application) async throws -> Void) async throws {
    let app = try await Application.make(.testing)
    do {
        try await configure(app)
        app.storage[TestTokenKey.self] = try await register(app, email: testEmail, password: testPassword).token
        try await test(app)
    } catch {
        try? await app.asyncShutdown()
        throw error
    }
    try await app.asyncShutdown()
}

// MARK: - Authentification

// Le jeton du compte de test est rangé dans le `storage` de l'application.
struct TestTokenKey: StorageKey {
    typealias Value = String
}

// Inscrit un compte via l'API et renvoie la réponse (jeton, expiration, compte).
func register(_ app: Application, email: String, password: String) async throws -> AuthResponseDTO {
    var response: AuthResponseDTO?
    try await app.test(.POST, "auth/register", beforeRequest: { req in
        try req.content.encode(LoginDTO(email: email, password: password))
    }, afterResponse: { res async throws in
        XCTAssertEqual(res.status, .created)
        response = try res.content.decode(AuthResponseDTO.self)
    })
    return try XCTUnwrap(response)
}

extension Application {
    // Le jeton du compte créé par `withApp`.
    var testToken: String {
        get throws { try XCTUnwrap(storage[TestTokenKey.self], "withApp n'a pas créé de compte") }
    }

    // Comme `app.test`, mais envoie `Authorization: Bearer <jeton>` (par défaut, celui du compte de test).
    @discardableResult
    func authTest(
        _ method: HTTPMethod,
        _ path: String,
        token: String? = nil,
        file: StaticString = #filePath,
        line: UInt = #line,
        beforeRequest: (inout XCTHTTPRequest) async throws -> () = { _ in },
        afterResponse: (XCTHTTPResponse) async throws -> () = { _ in }
    ) async throws -> XCTApplicationTester {
        var headers = HTTPHeaders()
        headers.bearerAuthorization = BearerAuthorization(token: try token ?? testToken)
        return try await test(
            method, path, headers: headers, file: file, line: line,
            beforeRequest: beforeRequest, afterResponse: afterResponse
        )
    }
}

// MARK: - Données de test

func createGame(
    _ app: Application,
    title: String = "Catan",
    minPlayers: Int = 3,
    maxPlayers: Int = 4,
    durationMinutes: Int = 90
) async throws -> GameDTO {
    var game: GameDTO?
    try await app.authTest(.POST, "games", beforeRequest: { req in
        try req.content.encode(CreateGameDTO(
            title: title,
            minPlayers: minPlayers,
            maxPlayers: maxPlayers,
            durationMinutes: durationMinutes
        ))
    }, afterResponse: { res async throws in
        game = try res.content.decode(GameDTO.self)
    })
    return try XCTUnwrap(game)
}

func createMember(
    _ app: Application,
    name: String = "Camille",
    email: String = "camille@example.com"
) async throws -> MemberDTO {
    var member: MemberDTO?
    try await app.authTest(.POST, "members", beforeRequest: { req in
        try req.content.encode(CreateMemberDTO(name: name, email: email))
    }, afterResponse: { res async throws in
        member = try res.content.decode(MemberDTO.self)
    })
    return try XCTUnwrap(member)
}

// The API cannot create a loan that is already late, so tests insert it directly.
func insertLoan(
    _ app: Application,
    gameID: UUID,
    memberID: UUID,
    borrowedAt: Date,
    dueAt: Date,
    returnedAt: Date? = nil
) async throws {
    let loan = Loan(gameID: gameID, memberID: memberID, borrowedAt: borrowedAt, dueAt: dueAt)
    loan.returnedAt = returnedAt
    try await loan.save(on: app.db)
}
