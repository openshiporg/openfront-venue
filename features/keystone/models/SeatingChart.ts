import { list, graphql } from '@keystone-6/core';
import { text, integer, checkbox, json, select, relationship, timestamp, virtual } from '@keystone-6/core/fields';
import { trackingFields } from './trackingFields';
import { validateChartMutation } from '../lib/chart-validation';
import { commandAccess, catalogAccessFor, permissions } from '../access';

export const SeatingChart = list({
 access: catalogAccessFor('canManageRooms'),
 hooks: { validate: args => validateChartMutation(args, 'chart') },
 fields: {
  name: text({}),
  version: integer({ defaultValue: 1 }),
  status: select({ type: 'string', options: ['draft', 'published', 'retired'], defaultValue: 'draft', access: { update: () => false } }),
  room: relationship({ ref: 'Room.seatingChart_room', many: false }),
  chartSection_chart: relationship({ ref: 'ChartSection.chart', many: true, access: { create: () => false, update: () => false } }),
  event_seatingChart: relationship({ ref: 'Event.seatingChart', many: true }),
  ...trackingFields,
 }
});
