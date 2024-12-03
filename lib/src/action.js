"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.action = action;
/* eslint-disable @typescript-eslint/no-explicit-any */
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const processors_1 = require("xml2js/lib/processors");
const glob = __importStar(require("@actions/glob"));
const process_1 = require("./process");
const render_1 = require("./render");
const util_1 = require("./util");
async function action() {
    let continueOnError = true;
    try {
        const token = core.getInput('token');
        if (!token) {
            core.setFailed("'token' is missing");
            return;
        }
        const pathsString = core.getInput('paths');
        if (!pathsString) {
            core.setFailed("'paths' is missing");
            return;
        }
        const reportPaths = pathsString.split(',');
        const minCoverageOverall = parseFloat(core.getInput('min-coverage-overall'));
        const minCoverageChangedFiles = parseFloat(core.getInput('min-coverage-changed-files'));
        const title = core.getInput('title');
        const updateComment = (0, processors_1.parseBooleans)(core.getInput('update-comment'));
        if (updateComment) {
            if (!title) {
                core.info("'title' is not set. 'update-comment' does not work without 'title'");
            }
        }
        const skipIfNoChanges = (0, processors_1.parseBooleans)(core.getInput('skip-if-no-changes'));
        const passEmoji = core.getInput('pass-emoji');
        const failEmoji = core.getInput('fail-emoji');
        continueOnError = (0, processors_1.parseBooleans)(core.getInput('continue-on-error'));
        const debugMode = (0, processors_1.parseBooleans)(core.getInput('debug-mode'));
        const shouldIncludeOverallCoverage = (0, processors_1.parseBooleans)(core.getInput('include-overall-coverage'));
        const shouldIncludeDeltaCoverage = (0, processors_1.parseBooleans)(core.getInput('include-delta-coverage'));
        if (!shouldIncludeDeltaCoverage && !shouldIncludeOverallCoverage) {
            throw new Error("either delta coverage or overall coverage should be true");
        }
        const event = github.context.eventName;
        core.info(`Event is ${event}`);
        if (debugMode) {
            core.info(`passEmoji: ${passEmoji}`);
            core.info(`failEmoji: ${failEmoji}`);
        }
        let base;
        let head;
        let prNumberOpt;
        switch (event) {
            case 'pull_request':
            case 'pull_request_target':
                base = github.context.payload.pull_request?.base.sha;
                head = github.context.payload.pull_request?.head.sha;
                prNumberOpt = github.context.payload.pull_request?.number;
                break;
            // case 'push':
            //   base = github.context.payload.before
            //   head = github.context.payload.after
            //   break
            default:
                throw new Error(`Only pull requests are supported, ${github.context.eventName} not supported.`);
        }
        core.info(`base sha: ${base}`);
        core.info(`head sha: ${head}`);
        core.info(`PR: ${prNumberOpt}`);
        if (!prNumberOpt) {
            core.setFailed(`Need a PR number to proceed`);
            return;
        }
        let prNumber = prNumberOpt;
        const client = github.getOctokit(token);
        if (debugMode)
            core.info(`reportPaths: ${reportPaths}`);
        const changedFiles = await getChangedFiles(base, head, prNumber, client, debugMode);
        if (debugMode)
            core.info(`changedFiles: ${(0, util_1.debug)(changedFiles)}`);
        const reportsJsonAsync = getJsonReports(reportPaths, debugMode);
        const reports = await reportsJsonAsync;
        const project = (0, process_1.getProjectCoverage)(reports, changedFiles);
        if (debugMode)
            core.info(`project: ${(0, util_1.debug)(project)}`);
        core.setOutput('coverage-overall', project.overall ? parseFloat(project.overall.percentage.toFixed(2)) : 100);
        core.setOutput('coverage-changed-files', parseFloat(project['coverage-changed-files'].toFixed(2)));
        const skip = skipIfNoChanges && project.modules.length === 0;
        if (debugMode)
            core.info(`skip: ${skip}`);
        if (debugMode)
            core.info(`prNumber: ${prNumber}`);
        if (prNumber != null && !skip) {
            const emoji = {
                pass: passEmoji,
                fail: failEmoji,
            };
            await addComment(prNumber, updateComment, (0, render_1.getTitle)(title), (0, render_1.getPRComment)(project, {
                overall: minCoverageOverall,
                changed: minCoverageChangedFiles,
            }, {
                overall: shouldIncludeOverallCoverage,
                changed: shouldIncludeDeltaCoverage
            }, title, emoji), client, debugMode);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            if (continueOnError) {
                core.error(error);
            }
            else {
                core.setFailed(error);
            }
        }
    }
}
async function getJsonReports(xmlPaths, debugMode) {
    const globber = await glob.create(xmlPaths.join('\n'));
    const files = await globber.glob();
    if (debugMode)
        core.info(`Resolved files: ${files}`);
    return Promise.all(files.map(async (path) => {
        const reportXml = await fs.promises.readFile(path.trim(), 'utf-8');
        return await (0, util_1.parseToReport)(reportXml);
    }));
}
async function getChangedFiles(base, head, prNumber, client, debugMode) {
    // const response = await client.rest.repos.compareCommits({
    //   base,
    //   head,
    //   owner: github.context.repo.owner,
    //   repo: github.context.repo.repo,
    // })
    const response = await client.rest.pulls.listFiles({
        pull_number: prNumber,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });
    const changedFiles = [];
    for (const file of response.data) {
        if (debugMode)
            core.info(`file: ${(0, util_1.debug)(file)}`);
        const hash = (0, util_1.computeSHA256)(file.filename);
        const changedFile = {
            filePath: file.filename,
            url: file.blob_url,
            lines: (0, util_1.getChangedLines)(file.patch),
            prUrl: `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/pull/${prNumber}/files#diff-${hash}`,
        };
        changedFiles.push(changedFile);
    }
    return changedFiles;
}
async function addComment(prNumber, update, title, body, client, debugMode) {
    let commentUpdated = false;
    if (debugMode)
        core.info(`update: ${update}`);
    if (debugMode)
        core.info(`title: ${title}`);
    if (debugMode)
        core.info(`JaCoCo Comment: ${body}`);
    if (update && title) {
        if (debugMode)
            core.info('Listing all comments');
        const comments = await client.rest.issues.listComments({
            issue_number: prNumber,
            ...github.context.repo,
        });
        const comment = comments.data.find((it) => it.body.startsWith(title));
        if (comment) {
            if (debugMode)
                core.info(`Updating existing comment: id=${comment.id} \n body=${comment.body}`);
            await client.rest.issues.updateComment({
                comment_id: comment.id,
                body,
                ...github.context.repo,
            });
            commentUpdated = true;
        }
    }
    if (!commentUpdated) {
        if (debugMode)
            core.info('Creating a new comment');
        await client.rest.issues.createComment({
            issue_number: prNumber,
            body,
            ...github.context.repo,
        });
    }
}
