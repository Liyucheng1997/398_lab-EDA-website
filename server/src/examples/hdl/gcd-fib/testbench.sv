`timescale 1ns / 1ps

module tb;
  logic        clk = 0, rst = 1;
  // GCD
  logic        g_start = 0, g_busy, g_done;
  logic [15:0] g_a = 0, g_b = 0, g_result;
  // Fibonacci
  logic        f_start = 0, f_busy, f_done;
  logic [5:0]  f_n = 0;
  logic [31:0] f_result;

  integer errors = 0, tests = 0;

  gcd       #(.W(16)) u_gcd (.clk(clk), .rst(rst), .start(g_start), .a_in(g_a), .b_in(g_b),
                             .busy(g_busy), .done(g_done), .result(g_result));
  fibonacci #(.W(32)) u_fib (.clk(clk), .rst(rst), .start(f_start), .n(f_n),
                             .busy(f_busy), .done(f_done), .result(f_result));

  always #5 clk = ~clk;

  // 参考模型：欧几里得算法（取模版本）
  function automatic integer ref_gcd(input integer x, input integer y);
    integer t;
    while (y != 0) begin
      t = x % y;
      x = y;
      y = t;
    end
    return x;
  endfunction

  function automatic logic [31:0] ref_fib(input integer k);
    logic [31:0] p, q, t;
    p = 0;
    q = 1;
    repeat (k) begin
      t = p + q;
      p = q;
      q = t;
    end
    return p;
  endfunction

  task automatic run_gcd(input logic [15:0] x, input logic [15:0] y);
    integer cycles;
    @(negedge clk);
    g_a = x; g_b = y; g_start = 1;
    @(negedge clk) g_start = 0;
    cycles = 1;
    while (!g_done) begin
      @(negedge clk);
      cycles = cycles + 1;
    end
    tests = tests + 1;
    $display("gcd(%5d, %5d) = %5d   用时 %0d 拍", x, y, g_result, cycles);
    if (g_result !== ref_gcd(x, y)) begin
      $display("  错误：期望 %0d", ref_gcd(x, y));
      errors = errors + 1;
    end
  endtask

  task automatic run_fib(input integer k);
    @(negedge clk);
    f_n = k[5:0]; f_start = 1;
    @(negedge clk) f_start = 0;
    while (!f_done) @(negedge clk);
    tests = tests + 1;
    if (f_result !== ref_fib(k)) begin
      $display("错误：F(%0d) = %0d，期望 %0d", k, f_result, ref_fib(k));
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    run_gcd(48, 18);
    run_gcd(1071, 462);
    run_gcd(17, 5);
    run_gcd(0, 9);
    run_gcd(1000, 1000);
    repeat (10) run_gcd(($random & 16'h3FF) + 1, ($random & 16'h3FF) + 1);

    for (integer k = 0; k <= 47; k = k + 1) run_fib(k);
    $display("F(10) = %0d, F(30) = %0d, F(47) = %0d", ref_fib(10), ref_fib(30), ref_fib(47));

    if (errors == 0) $display("PASS: %0d 次 GCD / Fibonacci 计算全部正确", tests);
    else             $display("FAIL: %0d/%0d 次计算出错", errors, tests);
    $finish;
  end
endmodule
