const { currentFacet, Observe, List, Map, Set, Skeleton } = require("@syndicate-lang/core");

assertion type WorkItem(worker, item, result);
assertion type Job(item, result);
assertion type JobResult(output);
assertion type JobError(err);

export {
  WorkItem, Job,
  JobResult, JobError,
};

spawn named 'JobDispatcher' {
  field this.readyWorkers = Map(); // Pattern -> Set(WorkerId)
  field this.runningJobs = 0;
  // dataflow console.log(this.runningJobs + ' runningJobs; readyWorkers: ' + this.readyWorkers);

  during Observe(Observe(WorkItem($worker, $pattern, _))) {
    if (!Skeleton.isCompletelyConcrete(pattern)) {
      on start addWorker(pattern, worker);
      on stop removeWorker(pattern, worker);
    }
  }

  // TODO: reuse the dataspace's index somehow to get a more efficient
  // job-dispatcher? Once quoting issues are solved, something like
  //
  // during Observe(Observe(WorkItem(_, $pattern, _))) {
  //   field this.readyWorkers = Set();
  //   during Observe(Observe(WorkItem($worker, pattern, _))) { ... }
  //   during Observe(Job(fixquoting(pattern), _)) { ... }
  // }

  const addWorker = (pattern, worker) => {
    const rw = this.readyWorkers;
    this.readyWorkers = rw.set(pattern, rw.get(pattern, Set()).add(worker));
  };

  const removeWorker = (pattern, worker) => {
    const rw = this.readyWorkers;
    const ws = rw.get(pattern, Set()).remove(worker);
    if (ws.isEmpty()) {
      this.readyWorkers = rw.remove(pattern);
    } else {
      this.readyWorkers = rw.set(pattern, ws);
    }
  };

  const findWorkerSet = (item) => {
    const matches = this.readyWorkers.filter((ids, pat) => Skeleton.match(pat, item) !== false);
    switch (matches.size) {
      case 0: return [null, Set()];
      default:
        console.error('Multiple workers claiming job', item, List(matches.keys()));
        /* FALL THROUGH */
      case 1: return matches.entries().next().value;
    }
  };

  during Observe(Job($item, _)) {
    on start this.runningJobs++;
    on stop  this.runningJobs--;

    const waitForWorker = (retryCount) => {
      if (retryCount === 3) {
        console.error('Failed job, too many retries', item);
        react {
          assert Job(item, JobError(new Error("Too many retries")));
        }
      } else {
        react {
          const facet = currentFacet();
          dataflow {
            const [itemPattern, workers] = findWorkerSet(item);
            if (!workers.isEmpty()) {
              const worker = workers.first();
              removeWorker(itemPattern, worker);
              facet.stop(() => {
                react {
                  stop on retracted Observe(Observe(WorkItem(worker, _, _))) {
                    console.warn('Worker withdrew before answering', worker);
                    waitForWorker(retryCount + 1);
                  }
                  stop on asserted WorkItem(worker, item, $result) {
                    addWorker(itemPattern, worker);
                    react assert Job(item, result);
                  }
                }
              });
            }
          }
        }
      }
    };

    on start waitForWorker(0);
  }
}
