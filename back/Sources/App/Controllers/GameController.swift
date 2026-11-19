import Fluent
import Vapor

struct GameController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let games = routes.grouped("games")
        games.get(use: index)
        games.post(use: create)
        games.group(":gameID") { game in
            game.get(use: show)
            game.put(use: updateGame)
            game.delete(use: deleteGame)
        }
    }

    @Sendable
    func index(req: Request) async throws -> [GameDTO] {
        try GameQuery.validate(query: req)
        let params = try req.query.decode(GameQuery.self)

        var query = Game.query(on: req.db)
            .with(\.$loans)
        if let title = params.q {
            query = query.filter(\.$title ~~ title)
        }
        if let players = params.players {
            query =
                query
                .filter(\.$minPlayers <= players)
                .filter(\.$maxPlayers >= players)
        }
        if let duration = params.maxDuration {
            query = query.filter(\.$durationMinutes <= duration)
        }

        var games = try await query.all()

        if let availability = params.available {
            games = games.filter{$0.isAvailable == availability}
        }

        return games.map { $0.toDTO() }
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        try CreateGameDTO.validate(content: req)
        let dto = try req.content.decode(CreateGameDTO.self)
        try dto.ensureConsistentPlayerCount()

        let game = dto.toModel()
        try await game.save(on: req.db)
        return try await game.toDTO().encodeResponse(status: .created, for: req)
    }

    @Sendable
    func show(req: Request) async throws -> GameDTO {
        try await findGame(req).toDTO()
    }

    @Sendable
    func updateGame(req: Request) async throws -> GameDTO {
        try CreateGameDTO.validate(content: req)
        let dto = try req.content.decode(CreateGameDTO.self)
        try dto.ensureConsistentPlayerCount()
        let game = try await findGame(req)

        game.title = dto.title
        game.minPlayers = dto.minPlayers
        game.maxPlayers = dto.maxPlayers
        game.durationMinutes = dto.durationMinutes

        try await game.update(on: req.db)
        return game.toDTO()
    }

    @Sendable
    func deleteGame(req: Request) async throws -> HTTPStatus {
        let game = try await findGame(req)

        guard
            try await Loan.query(on: req.db)
                .filter(\.$game.$id == game.requireID())
                .first()
                == nil
        else {
            throw Abort(
                .badRequest,
                reason:
                    "A game with loans cannot be deleted"
            )
        }

        try await game.delete(on: req.db)
        return .noContent
    }

    private func findGame(_ req: Request) async throws -> Game {
        guard let gameID = req.parameters.get("gameID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid game id")
        }
        guard
            let game = try await Game.query(on: req.db)
                .filter(\.$id == gameID)
                .with(\.$loans)
                .first()
        else {
            throw Abort(.notFound, reason: "Game not found")
        }
        return game
    }
}
