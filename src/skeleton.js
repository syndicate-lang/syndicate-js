"use strict";

var Immutable = require("immutable");
var Struct = require('./struct.js');
var $Special = require('./special.js');
var Bag = require('./bag.js');
var Assertions = require('./assertions.js');

function die(message) {
  throw new Error(message);
}

// "Skeletons" describe the indexed structure of a dataspace.
// In particular, they efficiently connect assertions to matching interests.

function emptySkeleton(cache) {
  return new SkNode(new SkCont(cache));
}

function SkNode(cont) {
  this.cont = cont;
  this.edges = Immutable.Map();
}

function SkCont(cache) {
  this.cache = cache || Immutable.Map();
  this.table = Immutable.Map();
}

function SkInterest(desc, constProj, key, varProj, handler, 



// A VisibilityRestriction describes ... TODO
// (visibility-restriction SkProj Assertion)
(struct visibility-restriction (path term) #:transparent)

// A ScopedAssertion is a VisibilityRestriction or an Assertion.
// (Corollary: Instances of `visibility-restriction` can never be assertions.)

// A `Skeleton` is a structural guard on an assertion: essentially,
// specification of (the outline of) its shape; its silhouette.
// Following a skeleton's structure leads to zero or more `SkCont`s.
//
//       Skeleton = (skeleton-node SkCont (AListof SkSelector (MutableHash SkClass SkNode)))
//     SkSelector = (skeleton-selector Nat Nat)
//        SkClass = StructType | (list-type Nat) | (vector-type Nat)
//
(struct skeleton-node (continuation [edges #:mutable]) #:transparent)
(struct skeleton-selector (pop-count index) #:transparent)
(struct list-type (arity) #:transparent)
(struct vector-type (arity) #:transparent)
//
// A `SkDesc` is a single assertion silhouette, usually the
// evaluation-result of `desc->skeleton-stx` from `pattern.rkt`.
//
// A `SkCont` is a *skeleton continuation*, a collection of "next
// steps" after a `Skeleton` has matched the general outline of an
// assertion.
//
// INVARIANT: At each level, the caches correspond to the
// appropriately filtered and projected contents of the dataspace
// containing the structures.
//
//      SkCont = (skeleton-continuation
//                 (MutableSet ScopedAssertion)
//                 (MutableHash SkProj (MutableHash SkKey SkConst)))
//     SkConst = (skeleton-matched-constant
//                 (MutableSet ScopedAssertion)
//                 (MutableHash SkProj SkAcc))
//       SkAcc = (skeleton-accumulator
//                 (MutableBag SkKey)
//                 (MutableSeteq (... -> Any)))
//
(struct skeleton-continuation (cache table) #:transparent)
(struct skeleton-matched-constant (cache table) #:transparent)
(struct skeleton-accumulator (cache handlers) #:transparent)
//
// A `SkProj` is a *skeleton projection*, a specification of loci
// within a tree-shaped assertion to collect into a flat list.
//
//     SkProj = (Listof (Listof Nat))
//
// The outer list specifies elements of the flat list; the inner lists
// specify paths via zero-indexed links to child nodes in the
// tree-shaped assertion being examined. A precondition for use of a
// `SkProj` is that the assertion being examined has been checked for
// conformance to the skeleton being projected.
//
// A `SkKey` is the result of running a `SkProj` over a term,
// extracting the values at the denoted locations.
//
//     SkKey = (Listof Any)
//
// Each `SkProj` in `SkCont` selects *constant* portions of the term
// for more matching against the `SkKey`s in the table associated with
// the `SkProj`. Each `SkProj` in `SkConst`, if any, selects
// *variable* portions of the term to be given to the handler
// functions in the associated `SkAcc`.

// A `SkInterest` is a specification for an addition to or removal
// from an existing `Skeleton`.
//
//     SkInterest = (skeleton-interest SkDesc
//                                     SkProj
//                                     SkKey
//                                     SkProj
//                                     (... -> Any)
//                                     (Option ((MutableBag SkKey) -> Any)))
//
// The `SkDesc` gives the silhouette. The first `SkProj` is the
// constant-portion selector, to be matched against the `SkKey`. The
// second `SkProj` is used on matching assertions to extract the
// variable portions, to be passed to the handler function.
//
(struct skeleton-interest (desc
                           const-selector
                           const-value
                           var-selector
                           handler
                           cleanup
                           ) #:transparent)

//---------------------------------------------------------------------------

(define (make-empty-skeleton/cache cache)
  (skeleton-node (skeleton-continuation cache
                                        (make-hash))
                 '()))

(define (make-empty-skeleton)
  (make-empty-skeleton/cache (make-hash)))

(define (skcont-add! c i)
  (match-define (skeleton-interest _desc cs cv vs h _cleanup) i)
  (define (make-matched-constant)
    (define assertions (make-hash))
    (hash-for-each (skeleton-continuation-cache c)
                   (lambda (a _)
                     (when (equal? (apply-projection (unscope-assertion a) cs) cv)
                       (hash-set! assertions a #t))))
    (skeleton-matched-constant assertions (make-hash)))
  (define cvt (hash-ref! (skeleton-continuation-table c) cs make-hash))
  (define sc (hash-ref! cvt cv make-matched-constant))
  (define (make-accumulator)
    (define cache (make-bag))
    (hash-for-each (skeleton-matched-constant-cache sc)
                   (lambda (a _)
                     (unpack-scoped-assertion [restriction-path term] a)
                     (when (or (not restriction-path) (equal? restriction-path vs))
                       (bag-change! cache (apply-projection term vs) 1))))
    (skeleton-accumulator cache (make-hasheq)))
  (define acc (hash-ref! (skeleton-matched-constant-table sc) vs make-accumulator))
  (hash-set! (skeleton-accumulator-handlers acc) h #t)
  (for [(vars (in-bag (skeleton-accumulator-cache acc)))] (apply h '+ vars)))

(define (skcont-remove! c i)
  (match-define (skeleton-interest _desc cs cv vs h cleanup) i)
  (define cvt (hash-ref (skeleton-continuation-table c) cs #f))
  (when cvt
    (define sc (hash-ref cvt cv #f))
    (when sc
      (define acc (hash-ref (skeleton-matched-constant-table sc) vs #f))
      (when acc
        (when (and cleanup (hash-has-key? (skeleton-accumulator-handlers acc) h))
          (cleanup (skeleton-accumulator-cache acc)))
        (hash-remove! (skeleton-accumulator-handlers acc) h)
        (when (hash-empty? (skeleton-accumulator-handlers acc))
          (hash-remove! (skeleton-matched-constant-table sc) vs)))
      (when (hash-empty? (skeleton-matched-constant-table sc))
        (hash-remove! cvt cv)))
    (when (hash-empty? cvt)
      (hash-remove! (skeleton-continuation-table c) cs))))

(define (term-matches-class? term class)
  (cond
    [(list-type? class) (and (list? term) (= (length term) (list-type-arity class)))]
    [(vector-type? class) (and (vector? term) (= (vector-length term) (vector-type-arity class)))]
    [(struct-type? class) (and (non-object-struct? term) (eq? (struct->struct-type term) class))]
    [else (error 'term-matches-class? "Invalid class: ~v" class)]))

(define (subterm-matches-class? term path class)
  (term-matches-class? (apply-projection-path (unscope-assertion term) path) class))

(define (unscope-assertion scoped-assertion)
  (match scoped-assertion
    [(visibility-restriction _ term) term]
    [term term]))

(define-syntax-rule (unpack-scoped-assertion [path term] expr)
  (define-values (path term)
    (match expr
      [(visibility-restriction p t) (values p t)]
      [other (values #f other)])))

(define (update-path path pop-count index)
  (append (drop-right path pop-count) (list index)))

(define (extend-skeleton! sk desc)
  (define (walk-node! path sk pop-count index desc)
    (match desc
      [(list class-desc pieces ...)
       (define class
         (cond [(struct-type? class-desc) class-desc]
               [(eq? class-desc 'list) (list-type (length pieces))]
               [(eq? class-desc 'vector) (vector-type (length pieces))]
               [else (error 'extend-skeleton! "Invalid class-desc: ~v" class-desc)]))
       (define selector (skeleton-selector pop-count index))
       (define table
         (match (assoc selector (skeleton-node-edges sk))
           [#f (let ((table (make-hash)))
                 (set-skeleton-node-edges! sk (cons (cons selector table) (skeleton-node-edges sk)))
                 table)]
           [(cons _selector table) table]))
       (define (make-skeleton-node-with-cache)
         (define unfiltered (skeleton-continuation-cache (skeleton-node-continuation sk)))
         (define filtered (make-hash))
         (hash-for-each unfiltered
                        (lambda (a _)
                          (when (subterm-matches-class? a path class)
                            (hash-set! filtered a #t))))
         (make-empty-skeleton/cache filtered))
       (define next (hash-ref! table class make-skeleton-node-with-cache))
       (walk-edge! (update-path path pop-count 0) next 0 0 pieces)]
      [_
       (values pop-count sk)]))
  (define (walk-edge! path sk pop-count index pieces)
    (match pieces
      ['()
       (values (+ pop-count 1) sk)]
      [(cons p pieces)
       (let-values (((pop-count sk) (walk-node! path sk pop-count index p)))
         (walk-edge! (update-path path 1 (+ index 1)) sk pop-count (+ index 1) pieces))]))
  (let-values (((_pop-count sk) (walk-edge! '(0) sk 0 0 (list desc))))
    sk))

(define (add-interest! sk i)
  (let ((sk (extend-skeleton! sk (skeleton-interest-desc i))))
    (skcont-add! (skeleton-node-continuation sk) i)))

(define (remove-interest! sk i)
  (let ((sk (extend-skeleton! sk (skeleton-interest-desc i))))
    (skcont-remove! (skeleton-node-continuation sk) i)))

(define (skeleton-modify! sk term0 modify-skcont! modify-skconst! modify-skacc!)
  (unpack-scoped-assertion [restriction-path term0-term] term0)

  (define (walk-node! sk term-stack)
    (match-define (skeleton-node continuation edges) sk)

    (modify-skcont! continuation term0)
    (hash-for-each (skeleton-continuation-table continuation)
                   (lambda (constant-proj key-proj-handler)
                     (define constants (apply-projection term0-term constant-proj))
                     (define proj-handler (hash-ref key-proj-handler constants #f))
                     (when proj-handler
                       (modify-skconst! proj-handler term0)
                       (hash-for-each (skeleton-matched-constant-table proj-handler)
                                      (lambda (variable-proj acc)
                                        // (when restriction-path
                                        //   (log-info "Restriction path ~v in effect; variable-proj is ~v, and term is ~v"
                                        //             restriction-path
                                        //             variable-proj
                                        //             term0))
                                        (when (or (not restriction-path)
                                                  (equal? restriction-path variable-proj))
                                          (define variables (apply-projection term0-term variable-proj))
                                          (modify-skacc! acc variables term0)))))))

    (for [(edge (in-list edges))]
      (match-define (cons (skeleton-selector pop-count index) table) edge)
      (define popped-stack (drop term-stack pop-count))
      (define pieces (car popped-stack))
      (define term (vector-ref pieces (+ index 1))) // adjust for struct identifier at beginning
      (define entry (hash-ref table
                              (cond [(non-object-struct? term) (struct->struct-type term)]
                                    [(list? term) (list-type (length term))]
                                    [(vector? term) (vector-type (vector-length term))]
                                    [else #f])
                              #f))
      (when entry
        (define new-pieces
          (cond [(non-object-struct? term) (struct->vector term)]
                [(list? term) (list->vector (cons 'list term))]
                [(vector? term) (list->vector (cons 'list (vector->list term)))]))
        (walk-node! entry (cons new-pieces popped-stack)))))

  (walk-node! sk (list (vector 'list term0-term))))

(define (add-term-to-skcont! skcont term)
  (hash-set! (skeleton-continuation-cache skcont) term #t))
(define (add-term-to-skconst! skconst term)
  (hash-set! (skeleton-matched-constant-cache skconst) term #t))
(define (add-term-to-skacc! skacc vars _term)
  // (log-info ">>>>>> At addition time for ~v, cache has ~v"
  //           _term
  //           (hash-ref (skeleton-accumulator-cache skacc) vars 0))
  (match (bag-change! (skeleton-accumulator-cache skacc) vars 1)
    ['absent->present
     (hash-for-each (skeleton-accumulator-handlers skacc)
                    (lambda (handler _) (apply handler '+ vars)))]
    // 'present->absent and 'absent->absent absurd
    ['present->present
     (void)]))

(define (add-assertion! sk term)
  (skeleton-modify! sk
                    term
                    add-term-to-skcont!
                    add-term-to-skconst!
                    add-term-to-skacc!))

(define (remove-term-from-skcont! skcont term)
  (hash-remove! (skeleton-continuation-cache skcont) term))
(define (remove-term-from-skconst! skconst term)
  (hash-remove! (skeleton-matched-constant-cache skconst) term))
(define (remove-term-from-skacc! skacc vars _term)
  (define cache (skeleton-accumulator-cache skacc))
  // (log-info ">>>>>> At removal time for ~v, cache has ~v" _term (hash-ref cache vars 0))
  (if (bag-member? cache vars)
      (match (bag-change! cache vars -1)
        ['present->absent
         (hash-for-each (skeleton-accumulator-handlers skacc)
                        (lambda (handler _) (apply handler '- vars)))]
        // 'absent->absent and 'absent->present absurd
        ['present->present
         (void)])
      (log-warning "Removing assertion not previously added: ~v" _term)))

(define (remove-assertion! sk term)
  (skeleton-modify! sk
                    term
                    remove-term-from-skcont!
                    remove-term-from-skconst!
                    remove-term-from-skacc!))

(define (send-assertion! sk term)
  (skeleton-modify! sk
                    term
                    void
                    void
                    (lambda (skacc vars _term)
                      (hash-for-each (skeleton-accumulator-handlers skacc)
                                     (lambda (handler _) (apply handler '! vars))))))

// TODO: avoid repeated descent into `term` by factoring out prefixes of paths in `proj`
(define (apply-projection term proj)
  (for/list [(path (in-list proj))]
    (apply-projection-path term path)))

(define (apply-projection-path term path)
  (for/fold [(term (list term))] [(index (in-list path))]
    (cond [(non-object-struct? term) (vector-ref (struct->vector term) (+ index 1))]
          [(list? term) (list-ref term index)]
          [(vector? term) (vector-ref term index)]
          [else (error 'apply-projection "Term representation not supported: ~v" term)])))

//---------------------------------------------------------------------------

(module+ test
  (struct a (x y) #:transparent)
  (struct b (v) #:transparent)
  (struct c (v) #:transparent)
  (struct d (x y z) #:transparent)

  (define sk
    (make-empty-skeleton/cache
     (make-hash (for/list [(x (list (a (b 'bee) (b 'cat))
                                    (a (b 'foo) (c 'bar))
                                    (a (b 'foo) (c 'BAR))
                                    (a (c 'bar) (b 'foo))
                                    (a (c 'dog) (c 'fox))
                                    (d (b 'DBX) (b 'DBY) (b 'DBZ))
                                    (d (c 'DCX) (c 'DCY) (c 'DCZ))
                                    (b 'zot)
                                    123))]
                  (cons x #t)))))

  (define i1
    (skeleton-interest (list struct:a (list struct:b #f) #f)
                       '((0 0 0))
                       '(foo)
                       '((0 1))
                       (lambda (op . bindings)
                         (printf "xAB HANDLER: ~v ~v\n" op bindings))
                       (lambda (vars)
                         (printf "xAB CLEANUP: ~v\n" vars))))

  (add-interest! sk i1)

  (void (extend-skeleton! sk (list struct:a (list struct:b #f) #f)))
  (void (extend-skeleton! sk (list struct:a #f (list struct:c #f))))
  (void (extend-skeleton! sk (list struct:a #f (list struct:c (list struct:b #f)))))
  (void (extend-skeleton! sk (list struct:a #f #f)))
  (void (extend-skeleton! sk (list struct:c #f)))
  (void (extend-skeleton! sk (list struct:b #f)))
  (void (extend-skeleton! sk (list struct:d (list struct:b #f) #f (list struct:b #f))))
  (void (extend-skeleton! sk (list struct:d (list struct:b #f) #f (list struct:c #f))))
  (void (extend-skeleton! sk (list struct:d (list struct:c #f) #f (list struct:b #f))))
  (void (extend-skeleton! sk (list struct:d (list struct:c #f) #f (list struct:c #f))))
  (check-eq? sk (extend-skeleton! sk #f))

  (add-interest! sk
                 (skeleton-interest (list struct:d (list struct:b #f) #f (list struct:c #f))
                                    '((0 2 0))
                                    '(DCZ)
                                    '((0) (0 0) (0 0 0) (0 1))
                                    (lambda (op . bindings)
                                      (printf "DBC HANDLER: ~v ~v\n" op bindings))
                                    (lambda (vars)
                                      (printf "DBC CLEANUP: ~v\n" vars))))

  (remove-assertion! sk (a (b 'foo) (c 'bar)))
  (remove-assertion! sk (d (b 'B1) (b 'DBY) (c 'DCZ)))
  (add-assertion! sk (d (b 'B1) (b 'DBY) (c 'DCZ)))
  (add-assertion! sk (d (b 'BX) (b 'DBY) (c 'DCZ)))
  (add-assertion! sk (d (b 'B1) (b 'DBY) (c 'CX)))
  (add-assertion! sk (d (b 'B1) (b 'DBY) (c 'DCZ)))
  (add-assertion! sk (d (b 'BX) (b 'DBY) (c 'DCZ)))
  (add-assertion! sk (d (b 'B1) (b 'DBY) (c 'CX)))

  (add-interest! sk
                 (skeleton-interest (list struct:d #f (list struct:b #f) #f)
                                    '((0 1 0))
                                    '(DBY)
                                    '((0 0) (0 2))
                                    (lambda (op . bindings)
                                      (printf "xDB HANDLER: ~v ~v\n" op bindings))
                                    (lambda (vars)
                                      (printf "xDB CLEANUP: ~v\n" vars))))

  (send-assertion! sk (d (b 'BX) (b 'DBY) (c 'DCZ)))
  (send-assertion! sk (d (b 'BX) (b 'DBY) (c 'DCZ)))

  (remove-assertion! sk (d (b 'B1) (b 'DBY) (c 'DCZ)))
  (remove-assertion! sk (d (b 'BX) (b 'DBY) (c 'DCZ)))
  (remove-assertion! sk (d (b 'B1) (b 'DBY) (c 'CX)))
  (remove-assertion! sk (d (b 'B1) (b 'DBY) (c 'DCZ)))
  (remove-assertion! sk (d (b 'BX) (b 'DBY) (c 'DCZ)))
  (remove-assertion! sk (d (b 'B1) (b 'DBY) (c 'CX)))
  // sk

  (remove-interest! sk i1)
  )
