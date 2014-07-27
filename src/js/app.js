/* global jQuery, initials, _, githubApi, markdown */

(function ($, initials, _, githubApi) {
  'use strict';

  var repoUrl = 'https://github.com/gr2m/milestones';
  var repoUsername = repoUrl.match(/github.com\/([^\/]+)/).pop();
  var repoName = repoUrl.match(/github.com\/[^\/]+\/([^\/]+)/).pop();
  var rowTemplate = '';
  rowTemplate += '<tr class="<%= isNewMilestone ? "newMilestone" : "" %>">\n';
  rowTemplate += '    <% if (isNewMilestone) { %>\n';
  rowTemplate += '    <th class="milestone" rowspan="<%= numMilestoneIssues %>">\n';
  rowTemplate += '        <% if (milestoneAssignee) { %>\n';
  rowTemplate += '        <div class="pull-right">\n';
  rowTemplate += '          <a href="<%= milestoneAssignee.html_url %>">\n';
  rowTemplate += '              <img src="<%= milestoneAssignee.avatar_url %>s=24" alt="<%= milestoneAssignee.login %>">\n';
  rowTemplate += '          </a>\n';
  rowTemplate += '        </div>\n';
  rowTemplate += '        <% } %>\n';
  rowTemplate += '        <strong><%= milestoneTitle %></strong>\n';
  rowTemplate += '        <small><%= markdownToHTML(milestoneDescription) %></small>\n';
  rowTemplate += '    </th>\n';
  rowTemplate += '    <% } %>\n';
  rowTemplate += '    <td class="task" data-nr="<%= number %>">\n';
  rowTemplate += '        <div class="pull-right">\n';
  rowTemplate += '          <% if (assignee && state === "active") { %>\n';
  rowTemplate += '          <a href="<%= assignee.html_url %>">\n';
  rowTemplate += '              <img src="<%= assignee.avatar_url %>s=24" alt="<%= assignee.login %>">\n';
  rowTemplate += '          </a>\n';
  rowTemplate += '          <% } %>\n';
  rowTemplate += '          <% if (effort === undefined) { %>\n';
  rowTemplate += '          <span class="label label-danger">unrated</span>\n';
  rowTemplate += '          <% } else {%>\n';
  rowTemplate += '          <div title="effort: <%= effort %>" class="progress" style="width: <%= effort * 2 %>0px">\n';
  rowTemplate += '            <% if (state !== "open") { %>\n';
  rowTemplate += '            <div class="progress-bar <%= state === "active" ? "progress-bar-striped active" : "" %>"  role="progressbar" aria-valuenow="45" aria-valuemin="0" aria-valuemax="100" style="width: 100%"></div>\n';
  rowTemplate += '            <% } %>\n';
  rowTemplate += '          </div>\n';
  rowTemplate += '          <% } %>\n';
  rowTemplate += '        </div>\n';
  rowTemplate += '        <strong>\n';
  rowTemplate += '            <%= title %>\n';
  rowTemplate += '            <% if (subtasks) { %>\n';
  rowTemplate += '            (<%= subtasks.closed %>/<%= subtasks.open + subtasks.closed %>)\n';
  rowTemplate += '            <% } %>\n';
  rowTemplate += '            <a href="<%= html_url %>">\n';
  rowTemplate += '              #<%= number %>\n';
  rowTemplate += '            </a>\n';
  rowTemplate += '        </strong>\n';
  rowTemplate += '        <small>\n';
  rowTemplate += '          <%= markdownToHTML(body) %>\n';
  rowTemplate += '          <a class="btn btn-default btn-xs" href="<%= html_url %>">\n';
  rowTemplate += '            open on GitHub\n';
  rowTemplate += '          </a>\n';
  rowTemplate += '        </small>\n';
  rowTemplate += '    </td>\n';
  rowTemplate += '</tr>';

  var progressTemplate = '';
  progressTemplate += '<div class="progress-container <% if (preceding > 50) { %>over50percent<% } %>" style="width: <%= total %>%; left: <%= preceding %>%;">';
  progressTemplate += '  <div class="progress">';
  progressTemplate += '    <div class="progress-bar" style="width: <%= closedPercent %>%"></div>';
  progressTemplate += '    <div class="progress-bar progress-bar-striped active" style="width: <%= activePercent %>%"></div>';
  progressTemplate += '    <div class="progress-bar progress-bar-danger" style="width: <%= unratedPercent %>%"></div>';
  progressTemplate += '  </div>';
  progressTemplate += '  <div class="label"><%= title %></div>';
  progressTemplate += '</div>';

  var stateMap = {
    'open': 0,
    'active': 1,
    'closed': 2
  };

  // issues might be local data which scheme might be outdated
  // so in case of an error, we clear the local cache
  window.onerror = function() {
    try {
      localStorage.clear();
    } catch(e) {}
  };

  cache('issues', githubApi.user(repoUsername).repo(repoName).issues.findAll)
  .progress(handleResponse)
  .done(handleResponse)
  .fail(handleError);

  $(document.body).on('click touchstart', 'th.milestone, td.task', toggleDescriptionInTaskCell);

  function cache (name, method) {
    var data;
    var defer = $.Deferred();
    try {
      data = JSON.parse(localStorage.getItem(name));
    } catch(e) {}

    if (data && method) {
      if (method) {
        defer.notify(data);
      } else {
        defer.resolve(data);
      }
    } else {
      if (! method) defer.reject();
    }

    method().done(function(data) {
      try {
        localStorage.setItem(name, JSON.stringify(data));
      } catch(e) {}
    }).done(function(data) {
      defer.resolve(data);
    });

    return defer.promise();
  }

  function handleResponse (issues) {
    var milestones = [];
    var owners = {};

    // instead of requiring collaborators with a separate request,
    // we build the ownersMap out of the issues useing the
    // issue.assignee property
    issues.forEach(function(issue) {
      if (! issue.assignee) return;
      owners[issue.assignee.login] = issue.assignee;
    });

    issues = issues.filter(function(issue) {
      return !! issue.milestone;
    });

    // milestones are passed as property to every issue. Instead
    // of sending an extra request to /repos/user/repo/milestones,
    // we build it out of the returned issues;
    milestones = issues.reduce(function(currentMilestones, issue) {
      var milestone = issue.milestone;
      var currentMilestoneIds;
      var currentMilestoneIndex;

      currentMilestoneIds = currentMilestones.map(function(milestone) {return milestone.id; });
      currentMilestoneIndex = currentMilestoneIds.indexOf(milestone.id);
      delete issue.milestone;

      if (currentMilestoneIndex === -1) {
        milestone.issues = [issue];
        currentMilestones.push(milestone);
      } else {
        milestone = currentMilestones[currentMilestoneIndex];
        milestone.issues.push(issue);
      }

      return currentMilestones;
    }, []);

    // we set issue effort & state based on issue labels
    // we set subtasks based on the issue body
    issues = issues.map(function(issue) {
      issue.state = getIssueState(issue);
      issue.effort = getIssueEffort(issue);
      issue.subtasks = getIssuesSubTasks(issue);
      return issue;
    });

    // at the end, we add total effort, state, owner, description
    // and sort the issues in milestones
    milestones = milestones.map(function(milestone) {
      var descriptionParts;
      var UNRATED_EFFORT = 7;
      milestone.effort = milestone.issues.reduce(function(effort, issue) {
        effort.total += issue.effort || UNRATED_EFFORT;
        if (issue.effort === undefined) {
          effort.unrated += UNRATED_EFFORT;
        } else {
          effort[issue.state] += issue.effort;
        }
        return effort;
      }, { total: 0, closed: 0, active: 0, open: 0, unrated: 0});
      if (milestone.open_issues > 0) {
        // either open (not started on any issue)
        // or active (at least 1 issue closed or active)
        milestone.state = milestone.issues.reduce(function(state, issue) {
          if (state === 'closed' || issue.state === 'closed') return 'active';
          if (state === 'active' || issue.state === 'active') return 'active';
          return state;
        }, 'open');
      } else {
        milestone.state = 'closed';
      }

      // milestone.description has a special format with the milestone owner
      // in the first line:
      //
      //     owner: gr2m
      //
      //     ---
      //
      //     actual description here ...
      descriptionParts = milestone.description.split(/\s+-{3,}\s+/);
      milestone.nr = parseInt(milestone.title);
      milestone.title = milestone.title.replace(/^\d+\s+/, '');
      milestone.assignee = owners[descriptionParts[0].substr(7)];
      milestone.description = descriptionParts[1];

      milestone.issues.sort(sortByStateAndUpdateAt);
      return milestone;
    });

    milestones.sort(sortByNr);

    renderChart(milestones);
    renderTasks(milestones);
  }


  function renderChart(milestones) {
    var currentTotal = 0;
    var allTotal;
    var html;
    milestones = milestones.map(function(milestone) {
      milestone.total = milestone.effort.total;
      milestone.closedPercent = parseInt(milestone.effort.closed / milestone.total * 100, 10);
      milestone.activePercent = parseInt(milestone.effort.active / milestone.total * 100, 10);
      milestone.unratedPercent = parseInt(milestone.effort.unrated / milestone.total * 100, 10);
      return milestone;
    });
    allTotal = milestones.reduce(function(allTotal, milestone) {
      return allTotal + milestone.total;
    }, 0);
    html = milestones.map(function(milestone) {
      milestone.total = milestone.total / allTotal * 100;
      currentTotal += milestone.total;

      return _.template(progressTemplate, _.extend({}, milestone, {
        preceding: currentTotal - milestone.total
      }));
    }).join('\n');
    $('.chart').html(html);
  }
  function renderTasks(milestones) {
    var htmlLines = [];
    milestones.forEach(function(milestone) {
      var milestoneHtmlLines = milestone.issues.map(function(issue, i, allIssues) {
        return _.template(rowTemplate, _.extend(issue, {
          isNewMilestone: i === 0,
          numMilestoneIssues: allIssues.length,
          milestoneTitle: milestone.title,
          milestoneDescription: milestone.description,
          milestoneAssignee: milestone.assignee,
          markdownToHTML: markdownToHTML
        }));
      });
      htmlLines = htmlLines.concat(milestoneHtmlLines);
    });
    $('tbody').html(htmlLines.join('\n'));
  }

  function handleError (error) {
    // window.alert('an error occured: ' + error);
    window.console.log(error);
  }

  function getIssueState (issue) {
    var state;
    var isActive;
    state = issue.state;
    isActive = issue.labels.filter(function(label) {
      return label.name === 'active';
    }).length === 1;
    if (isActive) {
      state = 'active';
    }
    return state;
  }

  function getIssueEffort (issue) {
    var effort;
    effort = issue.labels.reduce(function(effort, label) {
      var currentEffort = parseInt(label.name, 10);

      if (typeof currentEffort !== 'number') return effort;

      if (currentEffort > effort) return currentEffort;
      return effort;
    }, 0);
    // if no effort set, return unrated
    return effort || undefined;
  }

  function getIssuesSubTasks (issue) {
    var numSubTasksOpen;
    var numSubTasksClosed;
    var total;
    var text = issue.body || '';

    numSubTasksOpen = (text.match(/(^|\n)- \[\s+\]/g) || []).length;
    numSubTasksClosed = (text.match(/(^|\n)- \[x]/g) || []).length;

    total = numSubTasksOpen + numSubTasksClosed;
    if (numSubTasksClosed === total) return;

    return {
      open: numSubTasksOpen,
      closed: numSubTasksClosed
    };
  }

  function sortByStateAndUpdateAt (a, b) {
    if (stateMap[a.state] < stateMap[b.state]) return 1;
    if (stateMap[a.state] > stateMap[b.state]) return -1;
    if (a.update_at < b.update_at) return 1;
    if (a.update_at > b.update_at) return -1;

    return 0;
  }
  function sortByNr (a, b) {
    if (a.nr > b.nr) return 1;
    if (a.nr < b.nr) return -1;
    return 0;
  }

  function toggleDescriptionInTaskCell (event) {
    var $td = $(event.currentTarget);
    if ($(event.tarket).is('a')) return;
    $td.toggleClass('showDescription');
  }

  function markdownToHTML (text) {
    var html = markdown.toHTML(text || '');

    html = html.replace(/<li>\[\s+\]/g, '<li class="sub-task"><input type="checkbox" disabled>');
    html = html.replace(/<li>\[x\]/g, '<li class="sub-task"><input type="checkbox" checked disabled>');


    html = html.replace(/(https:\/\/github.com\/)?(\w+)\/([^#\/\s\n]+)\/issues\/(\d+)/g, ' $2/$3#$4');

    // make links clickable
    html = html.replace(/(https?:\/\/[^\s\n<]+)/g, '<a href="$1">$1</a>');

    // turn GitHub links into real links
    html = html.replace(/ (\w+)\/([^#]+)#(\d+)/g, ' <a href="https://github.com/$1/$2/issues/$3">$1/$2#$3</a>');


    // if (html.indexOf('hoodiehq/hoodie.js#311') !== -1) {
    //   debugger
    // }
    return html;
  }
})(jQuery, initials, _, githubApi, markdown);
