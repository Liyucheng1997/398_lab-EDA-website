`timescale 1ns / 1ps

// 演示 $display 的常用格式化方式。点击「运行」后在日志中查看输出。
module tb;
  logic [7:0] answer;
  real        pi = 3.14159265;

  hello_world dut (.answer(answer));

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    $timeformat(-9, 1, " ns", 10);  // %t 以 ns 为单位、保留 1 位小数
    $display("Hello, World!");
    $display("你好，WebEDA！");

    #1;  // 等组合逻辑稳定
    $display("十进制 %%d  : %0d", answer);
    $display("十六进制 %%h: 0x%h", answer);
    $display("二进制 %%b  : %b", answer);
    $display("八进制 %%o  : %o", answer);
    $display("字符 %%c    : %c", 8'd65 + answer[2:0]);
    $display("实数 %%f    : %.4f", pi);
    $display("仿真时间 %%t: %t", $realtime);
    $display("当前作用域 %%m: %m");

    if (answer == 8'd42) $display("PASS: answer = %0d", answer);
    else                 $display("FAIL: answer = %0d，期望 42", answer);
    $finish;
  end
endmodule
