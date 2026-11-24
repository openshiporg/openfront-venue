import { mergeSchemas } from "@graphql-tools/schema";
import { GraphQLError, type GraphQLSchema } from 'graphql';
import redirectToInit from "./redirectToInit";
import { storeLogoTypeDefs, storeLogo } from "./storeLogo";
import { availability, createHold } from './inventory';
import { operator } from './operators';
import { publishSeatingChart } from './charts';
import { requestRefundApproval, decideRefundApproval } from './approvals';
import { issueDoorSale, issueComp, previewDoorSale } from './doorSales';
import { refundDoorSale } from './doorRefunds';
import { editorMutations } from './editors';
import { openCashDrawer, closeCashDrawer, forceCloseCashDrawer } from './cashDrawers';
import updateActiveUser from './updateActiveUser';
import seedVenue from './seedVenue';
import { constraintRefusal, constraintGraphQLError } from '../lib/constraint-errors';
import { setRecordHidden } from './hidden';
import { startTicketCheckout, completeTicketCheckout, lookupTicketOrder, transferTicket, refundTicketOrder, retryTicketRefund, ticketOrderView, myTicketOrders, resendOrderConfirmation } from './checkout';
import { submitInquiry, workInquiry, venueAvails, publicRooms } from './inquiries';
import { venueDealMutations, viewVenueDeal, acceptVenueDeal, quoteVenueDeal } from './venueDeals';
import { sendEmailConfirmation, confirmCustomerEmail } from './customers';
import * as door from './door';
import { publicHostPolicy } from '../lib/sibling-http';

const graphql = String.raw;
const operatorCommands = ['releaseDateHold', 'advanceEvent', 'placeDateHold', 'challengeHold', 'confirmHold', 'sendOffer', 'acceptOffer', 'declineOffer', 'contractOffer', 'publishEvent', 'setProductionHold', 'releaseProductionHold', 'recordMerchSales', 'computeSettlement', 'adjustSettlement', 'signSettlement', 'recordArtistPayment', 'postponeEvent', 'cancelEvent'];

/** Command refusals are plain Errors with operator-facing text; surface them. Prisma and other internal errors stay masked. */
export function surfaceRefusals<T extends (...args: any[]) => any>(resolver: T): T {
  return (async (...args: any[]) => {
    try { return await resolver(...args); }
    catch (e: any) {
      // A database rule refused the write: say which rule in words, with a stable code.
      const refusal = constraintRefusal(e);
      if (refusal) throw e instanceof GraphQLError ? constraintGraphQLError(e, refusal) : new GraphQLError(refusal.message, { extensions: { code: refusal.code } });
      if (e && Object.getPrototypeOf(e) === Error.prototype) throw new GraphQLError(e.message); throw e;
    }
  }) as T;
}
const surfaced = (map: Record<string, any>) => Object.fromEntries(Object.entries(map).map(([k, f]) => [k, surfaceRefusals(f)]));

export function extendGraphqlSchema(baseSchema: GraphQLSchema) {
  return mergeSchemas({
    schemas: [baseSchema],
    typeDefs: graphql`
      input OperatorCommandInput { idempotencyKey: String! eventId: ID roomId: ID date: String rank: Int artistId: ID agencyId: ID expiresAt: String holdId: ID byHoldId: ID promoterId: ID notes: String phaseId: ID expenseId: ID data: JSON offerId: ID settlementId: ID dealId: ID productionHoldId: ID seatingChartId: ID title: String showAt: String doorsAt: String showTime: String doorsTime: String ageRestriction: String levelId: ID quantity: Int seatInventoryIds: [ID!] holdType: String releaseAt: String token: String ticketCode: String gate: String softGrossCents: Int hardGrossCents: Int sellerFeeCents: Int countIn: JSON countOut: JSON amountCents: Int reason: String approvedById: ID kind: String method: String reference: String status: String code: String issuer: String connectionId: ID externalEventId: String sellerName: String url: String csv: String filename: String mapping: JSON ticketId: ID externalTicketId: ID idChecked: Boolean name: String plusOnes: Int addedFor: String guestListEntryId: ID baseUrl: String }
      input UserUpdateProfileInput { email: String name: String password: String onboardingStatus: String }
      input CreateHoldInput { idempotencyKey: String! }
      input StartTicketCheckoutInput { holdId: ID! proof: String! email: String! name: String! ageAttested: Boolean idempotencyKey: String! }
      input CompleteTicketCheckoutInput { orderId: ID! proof: String! }
      input TransferTicketInput { ticketCode: String! orderId: ID! proof: String toEmail: String! toName: String idempotencyKey: String! }
      input RetryTicketRefundInput { refundId: ID! }
      input RefundTicketOrderInput { orderId: ID! amountCents: Int reason: String! idempotencyKey: String! approvalId: ID }
      input DoorTenderInput { kind: String! tenderedCents: Int reference: String }
      input DoorPreviewInput { eventId: ID! levelId: ID! qty: Int! comp: Boolean }
      input DoorSaleInput { eventId: ID! levelId: ID! qty: Int! seatInventoryIds: [ID!] name: String! email: String ageAttested: Boolean reason: String tender: DoorTenderInput idempotencyKey: String! }
      input RefundApprovalRequestInput { orderId: ID! amountCents: Int! reason: String! cash: Boolean }
      input OpenCashDrawerInput { label: String! openingFloatCents: Int! idempotencyKey: String! }
      input CloseCashDrawerInput { drawerId: ID! count: JSON! reason: String idempotencyKey: String! }
      input ForceCloseCashDrawerInput { drawerId: ID! count: JSON! reason: String! idempotencyKey: String! }
      input RefundApprovalDecisionInput { approvalId: ID! decision: String! note: String }
      type Query {
        redirectToInit: Boolean
        eventsOnSale: JSON
        eventAvailability(eventId: ID!): JSON
        lookupTicketOrder(email: String!, orderNumber: String!): JSON
        ticketOrderView(orderId: ID!, proof: String): JSON
        myTicketOrders: JSON
        venueAvails(from: String, to: String, roomId: ID): JSON
        publicRooms: JSON
        viewVenueDeal(token: String!): JSON
        quoteVenueDeal(dealId: ID!, actuals: JSON): JSON
        connectedAvailability(eventId: ID!): JSON
        doorSearch(eventId: ID, term: String): JSON
        eventIssued(eventId: ID!): JSON
        channelEvents(connectionId: ID!): JSON
      }
      type Mutation {
        createGaHold(eventId: ID!, levelId: ID!, qty: Int!, presaleCode: String, idempotencyKey: String!): JSON
        createSeatHold(eventId: ID!, seatInventoryIds: [ID!]!, presaleCode: String, idempotencyKey: String!): JSON
        startTicketCheckout(input: StartTicketCheckoutInput!): JSON
        completeTicketCheckout(input: CompleteTicketCheckoutInput!): JSON
        transferTicket(input: TransferTicketInput!): JSON
        refundTicketOrder(input: RefundTicketOrderInput!): JSON
        retryTicketRefund(input: RetryTicketRefundInput!): JSON
        resendOrderConfirmation(orderId: ID!): JSON
        setRecordHidden(list: String!, id: ID!, hidden: Boolean!, reason: String): JSON
        submitInquiry(input: JSON!): JSON
        acceptVenueDeal(token: String!, name: String!, termsHash: String, idempotencyKey: String!): JSON
        ${Object.keys(venueDealMutations).map(name => `${name}(input: OperatorCommandInput!): JSON`).join('\n        ')}
        workInquiry(input: JSON!): JSON
        sendEmailConfirmation: JSON
        confirmCustomerEmail(userId: ID!, proof: String!): JSON
        updateActiveUser(data: UserUpdateProfileInput!): User
        seedVenue(section: String!, data: JSON!): JSON
        publishSeatingChart(input: OperatorCommandInput!): JSON
        requestRefundApproval(input: RefundApprovalRequestInput!): JSON
        issueDoorSale(input: DoorSaleInput!): JSON
        issueComp(input: DoorSaleInput!): JSON
        previewDoorSale(input: DoorPreviewInput!): JSON
        refundDoorSale(input: RefundTicketOrderInput!): JSON
        decideRefundApproval(input: RefundApprovalDecisionInput!): JSON
        openCashDrawer(input: OpenCashDrawerInput!): JSON
        closeCashDrawer(input: CloseCashDrawerInput!): JSON
        forceCloseCashDrawer(input: ForceCloseCashDrawerInput!): JSON
        scanTicket(input: OperatorCommandInput!): JSON
        admitWillCall(input: OperatorCommandInput!): JSON
        addGuestListEntry(input: OperatorCommandInput!): JSON
        removeGuestListEntry(input: OperatorCommandInput!): JSON
        admitGuestListEntry(input: OperatorCommandInput!): JSON
        importExternalTickets(input: OperatorCommandInput!): JSON
        voidExternalTicket(input: OperatorCommandInput!): JSON
        setEventIssuer(input: OperatorCommandInput!): JSON
        startChannelConnection(input: OperatorCommandInput!): JSON
        checkChannelConnection(input: OperatorCommandInput!): JSON
        disconnectChannel(input: OperatorCommandInput!): JSON
        ${Object.keys(editorMutations).map(name => `${name}(input: OperatorCommandInput!): JSON`).join('\n        ')}
        ${operatorCommands.map(name => `${name}(input: OperatorCommandInput!): JSON`).join('\n        ')}
      }
    ` + storeLogoTypeDefs,
    resolvers: {
      Query: {
        storeLogo,
        redirectToInit,
        eventsOnSale: async (_: any, __: any, context: any) => context.prisma.event.findMany({ where: { status: { in: ['announced', 'presale', 'on_sale', 'sold_out', 'postponed'] }, OR: [{ showAt: { gt: new Date() } }, { showAt: null }] }, orderBy: { showAt: 'asc' }, take: 100, select: { id: true, title: true, status: true, showAt: true, doorsAt: true, ageRestriction: true, room: { select: { name: true, city: true, timezone: true } } } }),
        eventAvailability: surfaceRefusals(availability),
        lookupTicketOrder: surfaceRefusals(lookupTicketOrder),
        ticketOrderView: surfaceRefusals(ticketOrderView),
        myTicketOrders: surfaceRefusals(myTicketOrders),
        venueAvails: surfaceRefusals(venueAvails),
        publicRooms: surfaceRefusals(publicRooms),
        viewVenueDeal: surfaceRefusals(viewVenueDeal),
        quoteVenueDeal: surfaceRefusals(quoteVenueDeal),
        // Every resolver that reaches a sibling passes the public-host URL policy.
        connectedAvailability: surfaceRefusals((_: any, a: any, c: any) => door.connectedAvailability(_, a, c, publicHostPolicy)),
        doorSearch: surfaceRefusals(door.doorSearch),
        eventIssued: surfaceRefusals((_: any, a: any, c: any) => door.eventIssued(_, a, c, publicHostPolicy)),
        channelEvents: surfaceRefusals((_: any, a: any, c: any) => door.channelEvents(_, a, c, publicHostPolicy)),
      },
      Mutation: surfaced({
        createGaHold: createHold,
        createSeatHold: createHold,
        seedVenue,
        publishSeatingChart, requestRefundApproval, decideRefundApproval, issueDoorSale, issueComp, previewDoorSale, refundDoorSale, openCashDrawer, closeCashDrawer, forceCloseCashDrawer,
        updateActiveUser, submitInquiry, workInquiry,
        startTicketCheckout, completeTicketCheckout, transferTicket, refundTicketOrder, retryTicketRefund, resendOrderConfirmation, sendEmailConfirmation, confirmCustomerEmail, setRecordHidden,
        ...editorMutations, ...venueDealMutations, acceptVenueDeal,
        scanTicket: (_: any, { input }: any, c: any) => door.scanAtDoor(c, input, publicHostPolicy),
        setEventIssuer: (_: any, a: any, c: any) => door.setEventIssuer(_, a, c, publicHostPolicy),
        admitWillCall: door.admitWillCall, addGuestListEntry: door.addGuestListEntry, removeGuestListEntry: door.removeGuestListEntry, admitGuestListEntry: door.admitGuestListEntry,
        importExternalTickets: door.importExternalTickets, voidExternalTicket: door.voidExternalTicket,
        startChannelConnection: door.startChannelConnection, checkChannelConnection: door.checkChannelConnection, disconnectChannel: door.disconnectChannel,
        ...Object.fromEntries(operatorCommands.map(name => [name, operator(name)])),
        // W6.2: opening doors here also opens them at a connected Concerts when the connected role allows; the answer is shown, never blocks.
        advanceEvent: async (root: any, args: any, c: any) => {
          const result = await operator('advanceEvent')(root, args, c);
          if (args?.input?.status === 'doors' && result?.status === 'doors') return { ...result, sibling: await door.openSiblingDoors(c.prisma, result.id, publicHostPolicy) };
          return result;
        },
      }),
    },
  });
}
