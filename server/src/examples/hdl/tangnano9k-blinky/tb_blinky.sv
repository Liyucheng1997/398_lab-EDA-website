`timescale 1ns / 1ps

// CLK_HZ = 40、COUNT_HZ = 4：每 10 拍计数一次
module tb;
  localparam CLK_HZ = 40, COUNT_HZ = 4, DIV = CLK_HZ / COUNT_HZ;

  logic       clk = 0;
  logic [1:0] btn_n = 2'b11;
  logic [5:0] led_n;
  logic [5:0] count;
  integer     errors = 0;

  blinky #(.CLK_HZ(CLK_HZ), .COUNT_HZ(COUNT_HZ)) dut (.clk(clk), .btn_n(btn_n), .led_n(led_n));

  assign count = ~led_n;   // 还原成计数值，便于阅读

  always #5 clk = ~clk;

  task automatic expect_count(input integer exp);
    if (count !== exp[5:0]) begin
      $display("[%0t] 错误：计数 = %0d，期望 %0d", $time, count, exp);
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    #1 expect_count(0);
    repeat (5 * DIV) @(negedge clk);
    $display("运行 %0d 拍后计数 = %0d", 5 * DIV, count);
    expect_count(5);

    // 按住 S1 暂停（同步器有 2 拍延迟）
    btn_n[0] = 0;
    repeat (3) @(negedge clk);
    begin : pause_check
      logic [5:0] frozen;
      frozen = count;
      repeat (4 * DIV) @(negedge clk);
      $display("暂停期间计数保持 %0d", count);
      if (count !== frozen) errors = errors + 1;
    end
    btn_n[0] = 1;

    // 按下 S2 清零
    btn_n[1] = 0;
    repeat (3) @(negedge clk);
    btn_n[1] = 1;
    $display("清零后计数 = %0d", count);
    expect_count(0);

    if (errors == 0) $display("PASS: Tang Nano 9K 闪灯行为正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
