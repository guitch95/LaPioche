import Fluent
import Vapor

struct LoanController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let loans = routes.grouped("loans")
        loans.get(use: index)
        loans.get("overdue", use: loansOverdue)
        loans.post(use: create)
        loans.delete(":loanID", use: deleteLoan)
        loans.post(":loanID", "return", use: returnedLoan)
    }

    @Sendable
    func index(req: Request) async throws -> [LoanDTO] {
        try await Loan.query(on: req.db).all().map { $0.toDTO() }

    }
    @Sendable
    func loansOverdue(req:Request) async throws -> [LoanDTO] {
        try await Loan.query(on: req.db)
            .filter(\.$dueAt < .now)
            .filter(\.$returnedAt == nil)
            .all()
            .map{$0.toDTO()}
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        let dto = try req.content.decode(CreateLoanDTO.self)

        guard let game = try await Game.find(dto.gameID, on: req.db) else {
            throw Abort(.notFound, reason: "Game not found")
        }
        guard let member = try await Member.find(dto.memberID, on: req.db)
        else {
            throw Abort(.notFound, reason: "Member not found")
        }

        // Refuse si le jeu a déjà un emprunt en cours
        guard try await Loan.query(on: req.db)
            .filter(\.$game.$id == dto.gameID)
            .filter(\.$returnedAt == nil)
            .first()
            == nil
        else {
            throw Abort(.conflict, reason: "Game already loaned")
        }

        let now = Date()
        let loan = Loan(
            gameID: try game.requireID(),
            memberID: try member.requireID(),
            borrowedAt: now,
            dueAt: try Loan.dueDate(from: now)
        )

        try await loan.save(on: req.db)
        return try await loan.toDTO().encodeResponse(status: .created, for: req)
    }

    @Sendable
    func returnedLoan(req: Request) async throws -> LoanDTO {
        let loan = try await findLoan(req)

        guard loan.returnedAt == nil else {
            throw Abort(.conflict, reason: "Loan already returned")
        }

        loan.returnedAt = .now
        try await loan.save(on: req.db)
        return loan.toDTO()
    }

    @Sendable
    func deleteLoan(req: Request) async throws -> HTTPStatus {
        let loan = try await findLoan(req)
        try await loan.delete(on: req.db)
        return .noContent
    }

    private func findLoan(_ req: Request) async throws -> Loan {
        guard let loanID = req.parameters.get("loanID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid loan id")
        }
        guard let loan = try await Loan.find(loanID, on: req.db)
        else {
            throw Abort(.notFound, reason: "Loan not found")
        }
        return loan
    }
}
