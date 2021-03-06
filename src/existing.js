'use strict';

const moment = require('moment-timezone');

function buildConditions(memberIdentifier, startDate) {
    // Adjust in case of timezone.
    startDate = moment(startDate).utc().subtract(1, 'days').format('YYYY-MM-DD');
    // TODO: Escaping?
    return 'member/identifier = "' + memberIdentifier + '" AND dateStart >= [' + startDate + ']';
}

function setupDay(list, key) {
    if (key in list) {
        return;
    }

    list[key] = {
        hours: 0,
        times: {},
        tickets: [],
        entries: [],
        ticketHours: {},
    };
}

function adjustTz(entry, timezone) {
    // If the time part of both is 0, it's not scheduled to a specific time.
    if (entry.start.utc().format('HHmmss') != '000000' || entry.end.utc().format('HHmmss') != '000000') {
        entry.start = entry.start.tz(timezone);
        entry.end = entry.end.tz(timezone);
    }
}

function entryHours(entry, days) {
    let hours = entry.hours / days;
    const type = entry.type.identifier;
    if ((type == 'V' || type == 'H') && hours >= 8) {
        // PTO (V) or holiday (H), full day.  Block everything off for sure.
        // This way dispatching 9 hours per day won't accidentally hit PTO days.
        return 12;
    }

    return hours;
}

function addEntry(list, ticketId, date, hours, entryId) {
    let key = date.format('YYYY-MM-DD');
    setupDay(list, key);

    list[key].hours += hours;
    if (ticketId) {
        list[key].tickets.push(ticketId);
        list[key].ticketHours[ticketId] = (list[key].ticketHours[ticketId] || 0) + hours;
    }

    // Map used time slots.
    let timeOfDay = moment(date);
    for (let t = 0; t < hours * 4; ++t) {
        list[key].times[timeOfDay.format('HH:mm')] = entryId || -1;
        timeOfDay.add(15, 'minutes');
    }
}

module.exports.add = addEntry;

module.exports.combinedTicketHours = function (list) {
    let ticketHours = {};
    for (let key in list) {
        if (!list[key].ticketHours) {
            continue;
        }

        const dayHours = list[key].ticketHours;
        for (let ticketId in dayHours) {
            ticketHours[ticketId] = (ticketHours[ticketId] || 0) + dayHours[ticketId];
        }
    }

    return ticketHours;
};

module.exports.get = function (cw, params) {
    const conditions = buildConditions(params.memberIdentifier, params.startDate);

    return cw.ScheduleAPI.ScheduleEntries.getScheduleEntries({
        conditions,
        pageSize: 1000,
    }).then(function(result) {
        let byDate = {};

        for (let entry of result) {
            if (entry.type.identifier == 'C') {
                // Outlook event - let's skip for now.
                continue;
            }

            entry.start = moment(entry.dateStart);
            entry.end = moment(entry.dateEnd);
            adjustTz(entry, params.timezone);

            // Rounds down, so 0 = 1 day, etc.
            let days = entry.end.diff(entry.start, 'days') + 1;
            let hours = entryHours(entry, days);

            for (let day = 0; day < days; ++day) {
                const key = moment(entry.start).add(day, 'days').format('YYYY-MM-DD');
                setupDay(byDate, key);

                const ticketId = entry.type.identifier == 'S' ? entry.objectId : false;
                addEntry(byDate, ticketId, entry.start, hours, entry.id);

                // Since we're splitting it up.
                entry.hours = hours;
                byDate[key].entries.push(entry);
            }
        }

        return byDate;
    });
};
