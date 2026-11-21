// Synthetic, shaped per LTA DataMall API User Guide v6.11 (BusArrival v3). Not real bus data.
const empty = { OriginCode: '', DestinationCode: '', EstimatedArrival: '', Monitored: 0, Latitude: '', Longitude: '', VisitNumber: '', Load: '', Feature: '', Type: '' };
const bus = (eta: string, monitored: number | string, load: string) => ({
  OriginCode: '77009', DestinationCode: '77009', EstimatedArrival: eta, Monitored: monitored,
  Latitude: '1.3154918333333334', Longitude: '103.9059125', VisitNumber: '1', Load: load, Feature: 'WAB', Type: 'SD',
});

export function busArrivalBody(stopCode = '83139', services?: unknown[]) {
  return {
    'odata.metadata': 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival',
    BusStopCode: stopCode,
    Services: services ?? [
      { ServiceNo: '15', Operator: 'GAS', NextBus: bus('2026-11-21T12:01:30+08:00', 1, 'SEA'), NextBus2: bus('2026-11-21T12:09:00+08:00', '0', 'SDA'), NextBus3: empty },
      { ServiceNo: '36', Operator: 'SBST', NextBus: bus('2026-11-21T12:03:00+08:00', 1, 'LSD'), NextBus2: empty, NextBus3: empty },
      { ServiceNo: '36A', Operator: 'SBST', NextBus: bus('2026-11-21T12:05:00+08:00', 1, 'SEA'), NextBus2: empty, NextBus3: empty },
    ],
  };
}
