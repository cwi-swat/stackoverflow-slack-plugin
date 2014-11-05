var fs = require('fs'),
    request = require('request')

if (!fs.existsSync("push-url.txt")) {
   console.error("push-url.txt is missing, please add the file and put the slack push URL in there");
   process.exit(1);
   return;
}
if (!fs.existsSync('last-end.txt')) {
   console.log("No last-end.txt file, making one");
   var now = Math.round(Date.now() / 1000)
   fs.writeFileSync('last-end.txt', now - (24*60*60)); // one day back
}

var targetPush = fs.readFileSync("push-url.txt", {"encoding":"utf8"});
var lastTime = parseInt(fs.readFileSync('last-end.txt', {"encoding":"utf8"}), 10);
var currentTime = Math.round(Date.now() / 1000);

if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

var QuestionURL = "https://api.stackexchange.com/2.2/questions?order=desc&sort=activity&tagged=rascal&site=stackoverflow";
var TimelineURL = "https://api.stackexchange.com/2.2/questions/{0}/timeline?site=stackoverflow";
var AnswerURL = "http://api.stackexchange.com/2.2/questions/{2}/answers?fromdate={0}&todate={1}&order=desc&sort=activity&site=stackoverflow";

function getJSON(target, success, error) {
   request({"uri":target,"gzip": true}, function (err, response, body) {
      if (!err && response.statusCode == 200) {
         success(JSON.parse(body), response, body);
      }
      else {
         console.log("get failed: " + target);
         error(err, response, body);
      }
   });
}

function historyEvent(tl, desc, emoij, link) {
   return {
      "when" : tl.creation_date,
      "who" : (tl.user || tl.owner).display_name,
      "what" : desc,
      "emoij": emoij,
      "link" : link
   };
}

function getAnswerLink(question, answer) {
   return "http://stackoverflow.com/a/{0}".format(answer);
}
function getCommentLink(question, answer, comment) {
   return "http://stackoverflow.com/questions/{0}//{1}#comment{2}_{1}".format(question, answer, comment);
}

getJSON(QuestionURL, 
   function(questions) {
      var currentResult = {};
      questions.items.forEach(function(q) {
         if (q.last_activity_date > lastTime) {
            currentResult[q.question_id] = { "title": q.title, "activity": q.last_activity_date, "link": q.link, "actions": [] };
         }
      });
      if (Object.keys(currentResult).length === 0) { 
         process.exit();
      }
      getJSON(TimelineURL.format(Object.keys(currentResult).join(";")), 
         function (timeline) {
            var checkQuestions = {};
            timeline.items.forEach(function(tl) {
		       if (tl.creation_date <= lastTime) {
			      return;
			   }
               var r = currentResult[tl.question_id];
               switch(tl.timeline_type) {
                  case "question":
                     r.actions.push(historyEvent(tl, "asked this question", ":raising_hand:"));
                     break;
                  case "revision": 
                     r.actions.push(historyEvent(tl, "revised this question",":pencil:"));
                     break;
                  case "accepted_answer":
                     r.actions.push(historyEvent(tl, "answer was accepted", ":ok_hand:", getAnswerLink(tl.question_id, tl.post_id)));
                     break;
                  case "answer": 
                     checkQuestions[tl.question_id] = checkQuestions[tl.question_id] || [];
                     checkQuestions[tl.question_id].push(tl.creation_date);
                     break;
                  case "unaccepted_answer":
                     r.actions.push(historyEvent(tl, "revised an answer", ":pencil:", getAnswerLink(tl.question_id, tl.post_id)));
                     break;
                  case "comment":
                     r.actions.push(historyEvent(tl, "made a comment", ":grey_question:", getCommentLink(tl.question_id, tl.post_id, tl.comment_id)));
                     break;
                  case "post_state_changed":
                  case "vote_aggregate":
                  default:
                     break;
               }
            });
            // now we handle new questions since they are not present in the
            // stream with an id.
            if (Object.keys(checkQuestions).length > 0) {
               getJSON(AnswerURL.format(lastTime, currentTime, Object.keys(checkQuestions).join(";")), 
                  function(answers) {
                     answers.items.forEach(function(a) {
                        var r = currentResult[a.question_id];
                        if (checkQuestions[a.question_id].indexOf(a.creation_date) > -1) {
                           r.actions.push(historyEvent(a, "posted an answer", ":clap:", getAnswerLink(a.question_id, a.answer_id)));
                        }
                     });
                     sendToSlack(currentResult);
                  },
                  handleError
               );
            }
            else {
               sendToSlack(currentResult);
            }
         }, 
         handleError
      );
   },
   handleError
);

function handleError(err, response, body) {
   console.error("Error getting with request: " + err);
   console.error(err);
   console.error(response);
   console.error(body);
   process.exit(1);
}

function sendToSlack(res) {
   var keys = Object.keys(res);
   if (keys.length) {
      payload = {
         "text" : "New StackOverflow activity on the <http://stackoverflow.com/questions/tagged/rascal|Rascal Tag>:\n\n",
         "unfurl_links": false
      };
      keys.forEach(function(rk) {
         var r = res[rk];
         payload.text += ":question: <{0}|{1}>:\n".format(r.link, r.title);
         r.actions.sort(function (a,b) { return a.when - b.when; });
         r.actions.forEach(function(a) {
            if (a.link) {
               payload.text += "\t\t\t {3} {0} <{2}|{1}>\n".format(a.who, a.what, a.link, a.emoij);
            }
            else {
               payload.text += "\t\t\t {2} {0} {1}\n".format(a.who, a.what, a.emoij);
            }
         });
         payload.text += "\n";
      });
      request.post({"url":targetPush, form: {"payload":JSON.stringify(payload)}}, function (error, response, body) {
         if (!error && response.statusCode == 200) {
            fs.writeFileSync('last-end.txt', currentTime);
         }
         else {
            console.error("Error pushing to Slack");
            console.error(error);
            console.error(response);
            console.error(body);
            process.exit(1);
         }
      });
   }
}

